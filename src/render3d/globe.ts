// The 3D Earth. Renders on demand (nothing is drawn while the view is still), cuts the Earth along any great-circle
// section, and draws each data layer with one or two draw calls.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { BOUNDARY_COLORS, SLAB_STATUS, quakeColor, slab2Color } from '../core/colormap';
import type { LayerKey, QuakeFilter } from '../core/store';
import type { Boundaries, PlateMesh, Quakes } from '../data/decode';
import { descentPath, fromXYZ, R_KM, toXYZ, type Vec3 } from '../science/geodesy';
import type { SectionFrame } from '../science/section';
import { depthsAt, isActive, subductingAt, type Slab } from '../science/slabs';

const V = (p: Vec3 | number[]) => new THREE.Vector3(p[0], p[1], p[2]);
const Y_UP = new THREE.Vector3(0, 1, 0);
const SHELLS = [
  { depth: 410, name: '410 km (olivine → wadsleyite)' },
  { depth: 660, name: '660 km (upper / lower mantle)' },
  { depth: 1000, name: '~1,000 km (viscosity increase)' },
  { depth: 2891, name: '2,891 km CMB' },
  { depth: 5150, name: '5,150 km ICB' },
];

/** Fresnel rim on a sphere: marks a boundary without hiding what is inside. */
function rimMaterial(color: string, strength: number) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color(color) }, strength: { value: strength } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; uniform float strength; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.5); gl_FragColor = vec4(color * f * strength, f * strength); }`,
  });
}

/** Earthquakes: filtering by magnitude, year and depth happens on the GPU; size from magnitude (see seismology.ts). */
function quakeMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, clipping: true,
    uniforms: { px: { value: 1 }, alpha: { value: 0.85 }, magR: { value: new THREE.Vector2(5, 10) }, yrR: { value: new THREE.Vector2(1900, 2100) }, depR: { value: new THREE.Vector2(0, 800) } },
    vertexShader: `attribute vec3 color; attribute vec3 mdy; varying vec3 vC; uniform float px; uniform vec2 magR; uniform vec2 yrR; uniform vec2 depR;
      #include <clipping_planes_pars_vertex>
      void main(){
        vC = color; vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
        bool keep = mdy.x >= magR.x - 0.001 && mdy.x <= magR.y + 0.001 && mdy.y >= depR.x && mdy.y <= depR.y && mdy.z >= yrR.x && mdy.z < yrR.y;
        gl_PointSize = keep ? clamp(2.2 * pow(10.0, 0.25 * (mdy.x - 5.0)), 1.5, 22.0) * px : 0.0;
        gl_Position = keep ? projectionMatrix * mvPosition : vec4(2.0, 2.0, 2.0, 1.0);
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `varying vec3 vC; uniform float alpha;
      #include <clipping_planes_pars_fragment>
      void main(){
        #include <clipping_planes_fragment>
        vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;
        float edge = smoothstep(0.5, 0.38, r); float ring = smoothstep(0.30, 0.42, r) * 0.35;
        gl_FragColor = vec4(mix(vC, vec3(0.0), ring), alpha * edge); }`,
  });
}

export interface CursorInfo { lon: number; lat: number; depthKm: number; onSection: boolean }
export interface Insets { left: number; right: number; top: number; bottom: number }

export class Globe {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.005, 50);
  readonly controls: OrbitControls;
  private scene = new THREE.Scene();
  private labels = new CSS2DRenderer();
  private surface!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private mantle!: THREE.Mesh;
  private layers = new Map<LayerKey, THREE.Object3D>();
  private rims: THREE.Object3D[] = [];
  private solidMats: THREE.Material[] = [];   // keep the far half when cut
  private sliceMats: THREE.Material[] = [];   // keep a swath around the cut
  private halfPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private slicePlanes = [new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)];
  private frame: SectionFrame | null = null;
  private sectionGroup = new THREE.Group();
  private arcLabels: CSS2DObject[] = [];
  private selLabel = new CSS2DObject(document.createElement('div'));
  private surfaceOpacity = 0.35;
  private insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private dirty = true;
  private flight: { p0: THREE.Vector3; p1: THREE.Vector3; t0v: THREE.Vector3; t1v: THREE.Vector3; u0: THREE.Vector3; u1: THREE.Vector3; start: number; ms: number } | null = null;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private down: { x: number; y: number } | null = null;

  // data kept for picking
  private quakes: Quakes | null = null;
  private quakeMat = quakeMaterial();
  private quakePos: Float32Array | null = null;
  private filter: QuakeFilter | null = null;
  private slabs: Slab[] = [];
  private slabMesh: THREE.InstancedMesh | null = null;
  private slabPos: THREE.Vector3[] = [];
  private slabShown: boolean[] = [];
  private bars: THREE.Mesh[] = [];
  private paths: THREE.LineSegments | null = null;
  private plateMesh: THREE.Mesh | null = null;
  private plateZone: Uint16Array | null = null;
  private plateMeshes: PlateMesh[] = [];

  onSlab: (s: Slab | null) => void = () => {};
  onQuake: (i: number) => void = () => {};
  onPlate: (hit: { zone: string; depthKm: number; dip: number; dipAz: number; lon: number; lat: number }) => void = () => {};
  onHoverSlab: (s: Slab | null) => void = () => {};
  onCursor: (c: CursorInfo | null) => void = () => {};
  onView: (v: { northDeg: number; kmPerPx: number }) => void = () => {};
  onContextLost: () => void = () => {};

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    host.append(this.renderer.domElement);
    this.labels.domElement.className = 'labels';
    host.append(this.labels.domElement);
    this.camera.position.set(0, 0.9, 3.4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.1, enablePan: true, screenSpacePanning: true, minDistance: 0.05, maxDistance: 8, rotateSpeed: 0.55, zoomSpeed: 1.1 });
    this.controls.addEventListener('start', () => { this.flight = null; });
    this.controls.addEventListener('change', () => this.invalidate());

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 2, 4);
    this.camera.add(sun);
    this.scene.add(this.camera);
    this.selLabel.element.className = 'slab-label';
    this.selLabel.visible = false;
    this.scene.add(this.selLabel);
    this.buildEarth();
    this.buildGraticule();

    const c = this.renderer.domElement;
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    c.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY }; });
    c.addEventListener('pointermove', (e) => this.pointerMove(e));
    c.addEventListener('pointerleave', () => this.onCursor(null));
    c.addEventListener('click', (e) => this.click(e));
    c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.renderer.setAnimationLoop(null); this.onContextLost(); });
    this.renderer.setAnimationLoop(() => this.tick());
  }

  invalidate() { this.dirty = true; }

  // ---------- static Earth ----------
  private buildEarth() {
    const tex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}img/earth.jpg`, () => this.invalidate());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0, transparent: true, opacity: this.surfaceOpacity, depthWrite: false }));
    this.surface.rotation.y = -Math.PI / 2; // texture u = 0 at lon -180 (see toXYZ)
    this.surface.renderOrder = 10;
    this.scene.add(this.surface);
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.012, 96, 48), rimMaterial('#7fb8ff', 0.5));
    this.scene.add(atmosphere); this.rims.push(atmosphere);
    this.mantle = new THREE.Mesh(new THREE.SphereGeometry(0.999, 96, 48), new THREE.MeshBasicMaterial({ color: '#3a2420', side: THREE.BackSide }));
    this.mantle.visible = false;
    this.scene.add(this.mantle);

    const shells = new THREE.Group();
    for (const d of [410, 660]) {
      const rim = new THREE.Mesh(new THREE.SphereGeometry(1 - d / R_KM, 96, 48), rimMaterial('#e8a25a', d === 660 ? 0.5 : 0.25));
      shells.add(rim); this.rims.push(rim);
    }
    const outer = new THREE.Mesh(new THREE.SphereGeometry(1 - 2891 / R_KM, 96, 48), new THREE.MeshStandardMaterial({ color: '#7a2e1a', roughness: 0.8, emissive: '#2a0a04', transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }));
    const inner = new THREE.Mesh(new THREE.SphereGeometry(1 - 5150 / R_KM, 64, 32), new THREE.MeshStandardMaterial({ color: '#e8b445', roughness: 0.6, emissive: '#4a2f00', transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    const cmbRim = new THREE.Mesh(new THREE.SphereGeometry(1 - 2891 / R_KM + 0.004, 96, 48), rimMaterial('#ff8a4c', 0.8));
    shells.add(outer, inner, cmbRim); this.rims.push(cmbRim);
    this.layers.set('shells', shells);
    this.scene.add(shells);
    this.solidMats.push(this.surface.material, this.mantle.material as THREE.Material, outer.material, inner.material);

    // section: boundary circles drawn in the cut plane (z = 0 in the group's frame), with labels
    const circle = (r: number, color: string, opacity: number, dashed = false) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 512; i++) { const a = (i / 512) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)); }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const l = new THREE.Line(g, dashed ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.01, gapSize: 0.008 }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
      if (dashed) l.computeLineDistances();
      return l;
    };
    this.sectionGroup.add(circle(1, '#e9ecf4', 0.75));
    for (const s of SHELLS) this.sectionGroup.add(circle(1 - s.depth / R_KM, s.depth === 2891 ? '#ff8a4c' : s.depth === 5150 ? '#f0c04a' : '#e8a25a', s.depth === 1000 ? 0.45 : 0.75, s.depth === 1000));
    for (const [d, text] of [[0, 'Surface'], ...SHELLS.map((s) => [s.depth, s.name])] as [number, string][]) {
      const el = document.createElement('div');
      el.className = 'arc-label';
      el.textContent = text;
      const o = new CSS2DObject(el);
      o.userData.r = 1 - d / R_KM;
      this.arcLabels.push(o); this.sectionGroup.add(o);
    }
    this.sectionGroup.visible = false;
    this.scene.add(this.sectionGroup);
  }

  private buildGraticule() {
    const pts: number[] = [], r = 1.0006;
    for (let lon = -180; lon < 180; lon += 30) for (let lat = -90; lat < 90; lat += 2) pts.push(...toXYZ(lon, lat).map((x) => x * r), ...toXYZ(lon, lat + 2).map((x) => x * r));
    for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 2) pts.push(...toXYZ(lon, lat).map((x) => x * r), ...toXYZ(lon + 2, lat).map((x) => x * r));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.LineBasicMaterial({ color: '#c9d3ea', transparent: true, opacity: 0.22, depthWrite: false });
    const l = new THREE.LineSegments(g, m); l.visible = false;
    this.solidMats.push(m);
    this.layers.set('graticule', l); this.scene.add(l);
  }

  // ---------- layers ----------
  setLayer(k: LayerKey, on: boolean) { const o = this.layers.get(k); if (o) { o.visible = on; this.invalidate(); } }

  setSurfaceOpacity(o: number) {
    this.surfaceOpacity = o;
    if (!this.frame) { this.surface.material.opacity = o; this.surface.material.depthWrite = o > 0.97; }
    this.invalidate();
  }

  setQuakes(q: Quakes) {
    this.quakes = q;
    const pos = new Float32Array(q.n * 3), col = new Float32Array(q.n * 3), mdy = new Float32Array(q.n * 3);
    for (let i = 0; i < q.n; i++) {
      pos.set(toXYZ(q.lon[i], q.lat[i], q.depth[i]), i * 3);
      col.set(quakeColor(q.depth[i]), i * 3);
      mdy[i * 3] = q.mag[i]; mdy[i * 3 + 1] = q.depth[i]; mdy[i * 3 + 2] = q.year[i];
    }
    this.quakePos = pos;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('mdy', new THREE.BufferAttribute(mdy, 3));
    const pts = new THREE.Points(g, this.quakeMat);
    pts.renderOrder = 5;
    pts.frustumCulled = false;
    this.sliceMats.push(this.quakeMat);
    this.layers.set('quakes', pts); this.scene.add(pts);
    this.applyClipping(); this.resize();
  }

  setQuakeFilter(f: QuakeFilter) {
    this.filter = f;
    const u = this.quakeMat.uniforms;
    u.magR.value.set(f.magMin, f.magMax); u.yrR.value.set(f.yrMin, f.yrMax); u.depR.value.set(f.depMin, f.depMax);
    this.invalidate();
  }

  /** Atlas slabs: one instanced sphere per midpoint, depth bars (core top-base, thin error extensions), descent paths. */
  setSlabs(slabs: Slab[]) {
    this.slabs = slabs;
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95 });
    this.slabMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), mat, slabs.length);
    this.slabMesh.frustumCulled = false;
    this.sliceMats.push(mat);
    g.add(this.slabMesh);
    this.layers.set('slabs', g); this.scene.add(g);
    this.setSlabTime(0, 'filter');
    this.applyClipping();
  }

  private disposeObj(o: THREE.Object3D | null) {
    if (!o) return;
    o.removeFromParent();
    o.traverse((x) => { const m = x as THREE.Mesh; m.geometry?.dispose(); const mm = m.material as THREE.Material | THREE.Material[] | undefined; if (mm) (Array.isArray(mm) ? mm : [mm]).forEach((k) => { this.sliceMats = this.sliceMats.filter((s) => s !== k); k.dispose(); }); });
  }

  /** t Ma. 'filter': present-day positions, slabs not subducting at t dimmed. 'advect': depths moved up by v t (vertical sinking). */
  setSlabTime(t: number, mode: 'filter' | 'advect') {
    if (!this.slabMesh) return;
    const g = this.layers.get('slabs')!;
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const coreParts: THREE.BufferGeometry[] = [], errParts: THREE.BufferGeometry[] = [], pathPos: number[] = [], pathCol: number[] = [];
    this.slabPos = []; this.slabShown = [];
    const cyl = (a: THREE.Vector3, b: THREE.Vector3, r: number, color: THREE.Color) => {
      const len = a.distanceTo(b); if (len < 1e-6) return null;
      const geo = new THREE.CylinderGeometry(r, r, len, 6, 1, true);
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, len / 2, 0));
      geo.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_UP, b.clone().sub(a).normalize())));
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(a.x, a.y, a.z));
      const n = geo.getAttribute('position').count, cols = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) cols.set([color.r, color.g, color.b], i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      geo.deleteAttribute('uv');
      return geo;
    };
    this.slabs.forEach((s, i) => {
      const d = mode === 'advect' && t > 0 ? depthsAt(s, t) : { top: s.top[0], mid: s.mid[2], base: s.base[0] };
      const lit = t === 0 || (mode === 'filter' ? subductingAt(s, t) : !!d);
      c.set(isActive(s) ? SLAB_STATUS.active : SLAB_STATUS.detached);
      if (!lit) c.multiplyScalar(0.25);
      const shown = !!d;
      const mid = V(toXYZ(s.mid[0], s.mid[1], d ? d.mid : s.mid[2]));
      this.slabPos.push(mid); this.slabShown.push(shown);
      const size = shown ? 0.0065 + Math.min(0.006, ((d!.base - d!.top) / R_KM) / 14) * (lit && t > 0 ? 1.3 : 1) : 0;
      m.compose(mid, new THREE.Quaternion(), new THREE.Vector3(size, size, size));
      this.slabMesh!.setMatrixAt(i, m);
      this.slabMesh!.setColorAt(i, c);
      if (!d) return;
      const P = (z: number) => V(toXYZ(s.mid[0], s.mid[1], Math.min(R_KM * 0.999, Math.max(0, z))));
      const core = cyl(P(d.top), P(d.base), 0.0018, c); if (core) coreParts.push(core);
      const e1 = cyl(P(d.top - s.top[1]), P(d.top), 0.0008, c), e2 = cyl(P(d.base), P(d.base + s.base[1]), 0.0008, c);
      if (e1) errParts.push(e1); if (e2) errParts.push(e2);
      if (s.surface && mode === 'filter') {
        const pts = descentPath(s.surface[0], s.surface[1], s.mid[0], s.mid[1], s.mid[2]);
        for (let k = 0; k < pts.length - 1; k++) { pathPos.push(...pts[k], ...pts[k + 1]); pathCol.push(c.r, c.g, c.b, c.r, c.g, c.b); }
      }
    });
    this.slabMesh.instanceMatrix.needsUpdate = true;
    if (this.slabMesh.instanceColor) this.slabMesh.instanceColor.needsUpdate = true;
    for (const b of this.bars) this.disposeObj(b);
    this.disposeObj(this.paths);
    this.bars = [];
    for (const [parts, opacity] of [[coreParts, 0.7], [errParts, 0.35]] as const) {
      if (!parts.length) continue;
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false });
      const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
      parts.forEach((p) => p.dispose());
      this.sliceMats.push(mat); this.bars.push(mesh); g.add(mesh);
    }
    if (pathPos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pathPos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(pathCol, 3));
      const mat = new THREE.LineDashedMaterial({ vertexColors: true, dashSize: 0.012, gapSize: 0.01, transparent: true, opacity: 0.45 });
      this.paths = new THREE.LineSegments(geo, mat);
      this.paths.computeLineDistances();
      this.sliceMats.push(mat); g.add(this.paths);
    } else this.paths = null;
    // today's earthquakes and Slab2 describe the present: fade them while looking back in time
    this.quakeMat.uniforms.alpha.value = t ? 0.1 : 0.85;
    const pm = this.plateMesh?.material as THREE.MeshStandardMaterial | undefined;
    if (pm) pm.opacity = t ? 0.12 : 0.85;
    this.applyClipping();
    this.invalidate();
  }

  /** Slab2 zones merged into one mesh; a per-vertex zone index serves picking. */
  setPlates(meshes: PlateMesh[]) {
    this.plateMeshes = meshes;
    const nv = meshes.reduce((a, m) => a + m.depths.length, 0), nt = meshes.reduce((a, m) => a + m.index.length, 0);
    const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), idx = new Uint32Array(nt), zone = new Uint16Array(nv);
    let vo = 0, io = 0;
    meshes.forEach((m, zi) => {
      pos.set(m.positions, vo * 3);
      for (let i = 0; i < m.depths.length; i++) { col.set(slab2Color(m.depths[i]), (vo + i) * 3); zone[vo + i] = zi; }
      for (let i = 0; i < m.index.length; i++) idx[io + i] = m.index[i] + vo;
      vo += m.depths.length; io += m.index.length;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.85, roughness: 0.7 });
    this.plateMesh = new THREE.Mesh(geo, mat);
    this.plateZone = zone;
    this.sliceMats.push(mat);
    this.layers.set('slab2', this.plateMesh); this.scene.add(this.plateMesh);
    this.applyClipping(); this.invalidate();
  }

  setBoundaries(b: Boundaries) {
    const pos = new Float32Array(b.n * 6), col = new Float32Array(b.n * 6), r = 1.0009, c = new THREE.Color();
    for (let i = 0; i < b.n; i++) {
      pos.set(toXYZ(b.lon0[i], b.lat0[i]).map((x) => x * r), i * 6);
      pos.set(toXYZ(b.lon1[i], b.lat1[i]).map((x) => x * r), i * 6 + 3);
      c.set(BOUNDARY_COLORS[b.classes[b.cls[i]][0]] ?? '#999999');
      col.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
    const l = new THREE.LineSegments(geo, mat);
    l.renderOrder = 11;
    this.solidMats.push(mat);
    this.layers.set('boundaries', l); this.scene.add(l);
    this.applyClipping(); this.invalidate();
  }

  // ---------- section ----------
  setSection(f: SectionFrame | null) {
    this.frame = f;
    this.mantle.visible = !!f;
    this.sectionGroup.visible = !!f;
    for (const r of this.rims) r.visible = !f;
    if (f) {
      const n = V(f.normal), w = f.section.halfWidthKm / R_KM;
      this.halfPlane.set(n.clone(), 0);                    // keep the half away from the camera (camera on -normal, so +along is to the right as in the 2D panel)
      this.slicePlanes[0].set(n.clone(), w);
      this.slicePlanes[1].set(n.clone().negate(), w);
      // orient the circles' plane: local x = centre direction, local z = normal
      const x = V(f.centre), z = n, y = z.clone().cross(x);
      this.sectionGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      // labels between A and the centre, one step apart in angle so they do not stack
      const a0 = -(f.section.halfLengthKm / R_KM) * 0.55;
      this.arcLabels.forEach((o, i) => o.position.set(Math.cos(a0 + i * 0.012) * o.userData.r, Math.sin(a0 + i * 0.012) * o.userData.r, 0));
    }
    for (const o of this.arcLabels) o.visible = !!f;
    this.surface.material.opacity = f ? 1 : this.surfaceOpacity;
    this.surface.material.depthWrite = !!f || this.surfaceOpacity > 0.97;
    this.applyClipping();
    this.invalidate();
  }

  private applyClipping() {
    const on = !!this.frame;
    for (const m of this.solidMats) { m.clippingPlanes = on ? [this.halfPlane] : null; m.needsUpdate = true; }
    for (const m of this.sliceMats) { m.clippingPlanes = on ? this.slicePlanes : null; m.needsUpdate = true; }
  }

  /** Point the camera at the cut face, square on, surface up. depthKm = deepest depth worth framing. */
  frameSection(f: SectionFrame, depthKm: number) {
    const zc = Math.min(R_KM * 0.5, depthKm / 2);
    const target = V(f.centre).multiplyScalar(1 - zc / R_KM);
    this.flyTo(target.clone().add(V(f.normal).multiplyScalar(-this.fitDistance(f.section.halfLengthKm * 1.05, depthKm * 0.55))), target, V(f.centre));
  }

  /** Camera distance at which a box of half-width hw km and half-height hh km fits in the free part of the screen. */
  private fitDistance(hwKm: number, hhKm: number) {
    const w = this.host.clientWidth, h = this.host.clientHeight, i = this.insets;
    const fullH = h + Math.abs(i.top - i.bottom), freeW = Math.max(120, w - i.left - i.right), freeH = Math.max(120, h - i.top - i.bottom);
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    return (Math.max(hwKm / freeW, hhKm / freeH) * fullH) / (t * R_KM);
  }


  /** Look at a point of the surface from above (orbiting the centre of the Earth), north up. */
  flyTowards(lon: number, lat: number, dist = 2.6) { this.flyTo(V(toXYZ(lon, lat, 0)).multiplyScalar(dist), new THREE.Vector3(), Y_UP.clone()); }
  resetView() { this.flyTo(this.camera.position.clone().normalize().multiplyScalar(3.4), new THREE.Vector3(), Y_UP.clone()); }

  setCamera(v: number[]) {
    this.camera.position.set(v[0], v[1], v[2]); this.controls.target.set(v[3], v[4], v[5]);
    this.controls.update(); this.invalidate();
  }
  getCamera(): number[] { const p = this.camera.position, t = this.controls.target; return [p.x, p.y, p.z, t.x, t.y, t.z]; }

  private setUp(u: THREE.Vector3) {
    this.camera.up.copy(u).normalize();
    const c = this.controls as unknown as { _quat: THREE.Quaternion; _quatInverse: THREE.Quaternion };
    c._quat.setFromUnitVectors(this.camera.up, Y_UP);
    c._quatInverse.copy(c._quat).invert();
  }

  private flyTo(to: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3) {
    this.flight = { p0: this.camera.position.clone(), p1: to, t0v: this.controls.target.clone(), t1v: target, u0: this.camera.up.clone(), u1: up, start: performance.now(), ms: matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 1400 };
    this.invalidate();
  }

  select(s: Slab | null) {
    this.selLabel.visible = !!s;
    if (s) {
      this.selLabel.element.textContent = s.name;
      const i = this.slabs.indexOf(s);
      this.selLabel.position.copy(i >= 0 ? this.slabPos[i] : V(toXYZ(s.mid[0], s.mid[1], s.mid[2])));
    }
    this.invalidate();
  }

  // ---------- picking ----------
  private toScreen(p: THREE.Vector3, rect: DOMRect): [number, number, number] {
    const v = p.clone().project(this.camera);
    return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height, v.z];
  }
  private kept(p: THREE.Vector3 | Vec3, slice: boolean): boolean {
    if (!this.frame) return true;
    const n = this.frame.normal, d = p instanceof THREE.Vector3 ? p.x * n[0] + p.y * n[1] + p.z * n[2] : p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
    return slice ? Math.abs(d) <= this.frame.section.halfWidthKm / R_KM : d >= 0;
  }
  pickSlab(x: number, y: number, maxPx = 14): Slab | null {
    if (!this.layers.get('slabs')?.visible) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    let best: Slab | null = null, bd = maxPx * maxPx;
    this.slabs.forEach((s, i) => {
      if (!this.slabShown[i] || !this.kept(this.slabPos[i], true)) return;
      const [sx, sy, sz] = this.toScreen(this.slabPos[i], rect);
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (sz < 1 && d < bd) { bd = d; best = s; }
    });
    return best;
  }
  pickQuake(x: number, y: number, maxPx = 8): number {
    const q = this.quakes, pos = this.quakePos, f = this.filter;
    if (!q || !pos || !this.layers.get('quakes')?.visible) return -1;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    let best = -1, bd = maxPx * maxPx;
    for (let i = 0; i < q.n; i++) {
      if (f && (q.mag[i] < f.magMin - 1e-3 || q.mag[i] > f.magMax + 1e-3 || q.depth[i] < f.depMin || q.depth[i] > f.depMax || q.year[i] < f.yrMin || q.year[i] >= f.yrMax)) continue;
      const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      if (this.frame && !this.kept([px, py, pz], true)) continue;
      const w = m[3] * px + m[7] * py + m[11] * pz + m[15]; if (w <= 0) continue;
      const sx = rect.left + (((m[0] * px + m[4] * py + m[8] * pz + m[12]) / w + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - (m[1] * px + m[5] * py + m[9] * pz + m[13]) / w) / 2) * rect.height;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  private setRay(x: number, y: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }
  pickPlate(x: number, y: number) {
    if (!this.plateMesh || !this.plateMesh.visible || !this.plateZone) return null;
    this.setRay(x, y);
    const hits = this.ray.intersectObject(this.plateMesh, false).filter((h) => this.kept(h.point, true));
    const h = hits[0]; if (!h?.face) return null;
    const vi = h.face.a, zi = this.plateZone[vi];
    let off = 0; for (let k = 0; k < zi; k++) off += this.plateMeshes[k].depths.length;
    const m = this.plateMeshes[zi], li = vi - off, ll = fromXYZ(h.point.x, h.point.y, h.point.z);
    return { zone: m.name, depthKm: ll.depthKm, dip: m.dip[li], dipAz: m.dipAz[li], lon: ll.lon, lat: ll.lat };
  }
  cursor(x: number, y: number): CursorInfo | null {
    this.setRay(x, y);
    if (this.frame) {
      const plane = new THREE.Plane(V(this.frame.normal), 0), p = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(plane, p) && p.length() <= 1) { const ll = fromXYZ(p.x, p.y, p.z); return { ...ll, onSection: true }; }
    }
    const p = new THREE.Vector3();
    if (this.ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), p)) { const ll = fromXYZ(p.x, p.y, p.z); return { ...ll, depthKm: 0, onSection: false }; }
    return null;
  }

  private pointerMove(e: PointerEvent) {
    if (e.buttons) return;
    const s = this.pickSlab(e.clientX, e.clientY);
    this.renderer.domElement.style.cursor = s ? 'pointer' : 'grab';
    this.onHoverSlab(s);
    this.onCursor(this.cursor(e.clientX, e.clientY));
  }
  private click(e: MouseEvent) {
    // a drag that ends on a dot is not a click
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return;
    const s = this.pickSlab(e.clientX, e.clientY);
    if (s) return this.onSlab(s);
    const q = this.pickQuake(e.clientX, e.clientY);
    if (q >= 0) return this.onQuake(q);
    const p = this.pickPlate(e.clientX, e.clientY);
    if (p) return this.onPlate(p);
  }

  // ---------- view ----------
  setInsets(i: Insets) { this.insets = i; this.resize(); }
  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    // centre the projection in the free area between the panels: render a w x h window of a larger frame whose
    // centre sits at the centre of the free area (aspect = that frame's, so nothing is stretched)
    const dx = (this.insets.left - this.insets.right) / 2, dy = (this.insets.top - this.insets.bottom) / 2;
    const fw = w + 2 * Math.abs(dx), fh = h + 2 * Math.abs(dy);
    this.camera.aspect = fw / fh;
    if (dx || dy) this.camera.setViewOffset(fw, fh, Math.abs(dx) - dx, Math.abs(dy) - dy, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.quakeMat.uniforms.px.value = this.renderer.getPixelRatio();
    this.invalidate();
  }

  private tick() {
    if (this.flight) {
      const f = Math.min(1, (performance.now() - this.flight.start) / this.flight.ms), e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
      // travel round the sphere, not through it
      const l0 = this.flight.p0.length(), l1 = this.flight.p1.length();
      const dir = this.flight.p0.clone().normalize().lerp(this.flight.p1.clone().normalize(), e);
      if (dir.lengthSq() < 1e-6) dir.copy(this.flight.p1).normalize();
      this.camera.position.copy(dir.normalize().multiplyScalar(l0 + (l1 - l0) * e));
      this.controls.target.lerpVectors(this.flight.t0v, this.flight.t1v, e);
      const up = this.flight.u0.clone().lerp(this.flight.u1, e);
      this.setUp(up.lengthSq() > 1e-6 ? up : this.flight.u1);
      if (f === 1) this.flight = null;
      this.dirty = true;
    }
    if (this.controls.update()) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    this.declutterLabels();
    // north arrow angle and scale at the orbit target for the HUD
    const north = Y_UP.clone().transformDirection(this.camera.matrixWorldInverse);
    const dist = this.camera.position.distanceTo(this.controls.target);
    const kmPerPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * R_KM) / this.host.clientHeight;
    this.onView({ northDeg: (Math.atan2(north.x, north.y) * 180) / Math.PI, kmPerPx });
  }

  /** Hide section labels that overlap each other or the interface panels. */
  private declutterLabels() {
    if (!this.frame) return;
    const blocks = [...document.querySelectorAll<HTMLElement>('[data-occludes]')].filter((e) => !e.hidden && e.getClientRects().length).map((e) => e.getBoundingClientRect());
    const placed: DOMRect[] = this.selLabel.visible ? [this.selLabel.element.getBoundingClientRect()] : [];
    for (const o of this.arcLabels) {
      const el = o.element; el.style.visibility = '';
      const r = el.getBoundingClientRect();
      const hit = (b: DOMRect) => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
      if (!o.visible || placed.some(hit) || blocks.some(hit)) { el.style.visibility = 'hidden'; continue; }
      placed.push(r);
    }
  }

  /** PNG of the current view at `scale` x the screen resolution, on a background colour. */
  async capture(scale = 2, background = '#0b0e1a'): Promise<Blob> {
    const pr = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(pr * scale);
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight, false);
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const c = Object.assign(document.createElement('canvas'), { width: src.width, height: src.height });
    const g = c.getContext('2d')!;
    g.fillStyle = background; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0);
    this.renderer.setPixelRatio(pr);
    this.resize();
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('capture failed'))), 'image/png'));
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); const mm = m.material as THREE.Material | THREE.Material[] | undefined; if (mm) (Array.isArray(mm) ? mm : [mm]).forEach((k) => k.dispose()); });
    this.renderer.dispose();
  }
}
