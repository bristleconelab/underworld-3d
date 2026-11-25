// The 3D Earth: a see-through surface, the main boundaries inside, earthquakes at their real depth, the subducting
// plates near the surface (Slab2) and the sunken slabs deep in the mantle (Atlas of the Underworld).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { isActive, LAYERS, QUAKE_BANDS, quakeBand, sinkingAt, toXYZ, type Quakes, type Slab } from './earth';

export const SLAB_COLORS = { active: '#7fd3ff', sunk: '#c3a6ff' };
const V = (p: [number, number, number]) => new THREE.Vector3(...p);

/** Glow on the rim of a sphere, strongest where it is seen edge-on: shows a boundary without hiding what is inside. */
function rimMaterial(color: string, strength: number) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide, blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color(color) }, strength: { value: strength } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; uniform float strength; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.5); gl_FragColor = vec4(color * f * strength, f * strength); }`,
  });
}

function pointsMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, clipping: true,
    uniforms: { scale: { value: 1 }, alpha: { value: 0.85 } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float scale;
      #include <clipping_planes_pars_vertex>
      void main(){ vC = color; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mvPosition.z; gl_Position = projectionMatrix * mvPosition;
      #include <clipping_planes_vertex>
      }`,
    fragmentShader: `varying vec3 vC; uniform float alpha;
      #include <clipping_planes_pars_fragment>
      void main(){
      #include <clipping_planes_fragment>
      vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; gl_FragColor = vec4(vC, alpha * smoothstep(0.5, 0.35, r)); }`,
  });
}

/** Half-width of the slice of quakes and slabs kept when the Earth is cut open (km). */
export const SECTION_HALF_KM = 760;

export type LayerName = 'quakes0' | 'quakes1' | 'quakes2' | 'slabs' | 'plates' | 'boundaries';

export class Globe {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
  readonly controls: OrbitControls;
  private scene = new THREE.Scene();
  private labels = new CSS2DRenderer();
  private surface!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private groups = new Map<LayerName, THREE.Object3D>();
  private slabMarkers: { slab: Slab; mesh: THREE.Mesh; extras: THREE.Object3D[] }[] = [];
  private arcLabels: CSS2DObject[] = [];
  private viewShift = 0;
  private hitTargets: THREE.Mesh[] = [];
  private label = new CSS2DObject(document.createElement('div'));
  private flight: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number; ms: number } | null = null;
  private quakeMaterials: THREE.ShaderMaterial[] = [];
  /** Cut-open view: the solid Earth keeps the far half; quakes and slabs keep a slice around the cut. */
  private halfPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private slicePlanes = [new THREE.Plane(new THREE.Vector3(0, 0, 1), SECTION_HALF_KM / 6371), new THREE.Plane(new THREE.Vector3(0, 0, -1), SECTION_HALF_KM / 6371)];
  private solidMaterials: THREE.Material[] = [];
  private sliceMaterials: THREE.Material[] = [];
  private rims: THREE.Object3D[] = [];
  private sectionArcs = new THREE.Group();
  private sectionOn = false;
  onPick: (s: Slab | null) => void = () => {};
  onHover: (s: Slab | null) => void = () => {};

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
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, minDistance: 0.25, maxDistance: 7, rotateSpeed: 0.55, autoRotate: true, autoRotateSpeed: 0.35 });
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false; this.flight = null; });

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 2, 4);
    this.camera.add(sun); // light follows the view, so the side you look at is always lit
    this.scene.add(this.camera);

    this.label.element.className = 'slab-label';
    this.label.visible = false;
    this.scene.add(this.label);

    this.buildInterior();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.domElement.addEventListener('pointermove', (e) => this.hover(e));
    this.renderer.domElement.addEventListener('click', (e) => this.click(e));
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private buildInterior() {
    const tex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}img/earth.jpg`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false }));
    this.surface.rotation.y = -Math.PI / 2; // texture u = 0 at lon -180 (see toXYZ)
    this.surface.renderOrder = 10;
    this.scene.add(this.surface);
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.012, 96, 48), rimMaterial('#7fb8ff', 0.55));
    this.scene.add(atmosphere);
    this.rims.push(atmosphere);

    // the inside of the mantle, only seen when the Earth is cut open
    const mantle = new THREE.Mesh(new THREE.SphereGeometry(0.998, 96, 48), new THREE.MeshBasicMaterial({ color: '#3a2420', side: THREE.BackSide }));
    mantle.visible = false;
    mantle.name = 'mantle';
    this.scene.add(mantle);

    const b = new THREE.Group();
    for (const l of LAYERS.slice(0, 2)) {
      const rim = new THREE.Mesh(new THREE.SphereGeometry(1 - l.depth / 6371, 96, 48), rimMaterial('#e8a25a', l.depth === 660 ? 0.5 : 0.25));
      b.add(rim); this.rims.push(rim);
    }
    const outer = new THREE.Mesh(new THREE.SphereGeometry(1 - 2891 / 6371, 96, 48), new THREE.MeshStandardMaterial({ color: '#7a2e1a', roughness: 0.8, emissive: '#2a0a04', transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }));
    const inner = new THREE.Mesh(new THREE.SphereGeometry(1 - 5150 / 6371, 64, 32), new THREE.MeshStandardMaterial({ color: '#e8b445', roughness: 0.6, emissive: '#4a2f00', transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    const cmbRim = new THREE.Mesh(new THREE.SphereGeometry(1 - 2891 / 6371 + 0.004, 96, 48), rimMaterial('#ff8a4c', 0.8));
    b.add(outer, inner, cmbRim);
    this.rims.push(cmbRim);
    this.groups.set('boundaries', b);
    this.scene.add(b);
    this.solidMaterials.push(this.surface.material, mantle.material, outer.material, inner.material);

    // section arcs: the boundaries drawn as circles in the cut plane (the plane is z = 0 in this group's frame)
    const circle = (r: number, color: string, opacity: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 256; i++) { const a = (i / 256) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)); }
      return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    };
    this.sectionArcs.add(circle(1, '#e9ecf4', 0.7));
    for (const l of LAYERS) this.sectionArcs.add(circle(1 - l.depth / 6371, l.depth === 2891 ? '#ff8a4c' : l.depth === 5150 ? '#f0c04a' : '#e8a25a', l.depth === 410 ? 0.35 : 0.7));
    const names: [number, string][] = [[0, 'Surface'], [660, '660 km: lower mantle starts'], [2891, '2,891 km: liquid outer core'], [5150, '5,150 km: solid inner core']];
    for (const [d, text] of names) {
      const el = document.createElement('div');
      el.className = 'arc-label';
      el.textContent = text;
      const o = new CSS2DObject(el);
      o.userData.r = 1 - d / 6371;
      this.arcLabels.push(o);
      this.sectionArcs.add(o);
    }
    this.sectionArcs.visible = false;
    this.scene.add(this.sectionArcs);
  }

  /** Cut the Earth along the meridian of lon (null = whole Earth). The camera should sit on the east side. */
  setSection(lon: number | null) {
    this.sectionOn = lon != null;
    const mantle = this.scene.getObjectByName('mantle')!;
    mantle.visible = this.sectionOn;
    this.sectionArcs.visible = this.sectionOn;
    for (const r of this.rims) r.visible = !this.sectionOn;
    if (lon != null) {
      const lo = (lon * Math.PI) / 180;
      const n = new THREE.Vector3(Math.cos(lo), 0, -Math.sin(lo)); // east, perpendicular to the meridian plane
      this.halfPlane.set(n.clone().negate(), 0);                  // keep the west half
      this.slicePlanes[0].set(n.clone(), SECTION_HALF_KM / 6371);
      this.slicePlanes[1].set(n.clone().negate(), SECTION_HALF_KM / 6371);
      this.sectionArcs.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    }
    for (const o of this.arcLabels) o.visible = this.sectionOn;
    for (const m of this.solidMaterials) { m.clippingPlanes = this.sectionOn ? [this.halfPlane] : null; m.needsUpdate = true; }
    for (const m of [...this.sliceMaterials, ...this.quakeMaterials]) { m.clippingPlanes = this.sectionOn ? this.slicePlanes : null; m.needsUpdate = true; }
    this.surface.material.opacity = this.sectionOn ? 1 : this.surfaceOpacity;
    this.surface.material.depthWrite = this.sectionOn || this.surfaceOpacity > 0.97;
  }
  private surfaceOpacity = 0.35;

  /** 0 = surface invisible (see everything inside), 1 = solid Earth. */
  setSurfaceOpacity(o: number) {
    this.surfaceOpacity = o;
    if (this.sectionOn) return;
    this.surface.material.opacity = o;
    this.surface.material.depthWrite = o > 0.97;
  }

  setVisible(layer: LayerName, on: boolean) {
    const g = this.groups.get(layer);
    if (g) g.visible = on;
  }

  setQuakes(q: Quakes) {
    for (let band = 0; band < QUAKE_BANDS.length; band++) {
      const idx: number[] = [];
      for (let i = 0; i < q.n; i++) if (quakeBand(q.depth[i]) === band) idx.push(i);
      const pos = new Float32Array(idx.length * 3), col = new Float32Array(idx.length * 3), size = new Float32Array(idx.length);
      const c = new THREE.Color(QUAKE_BANDS[band].color);
      idx.forEach((i, k) => {
        pos.set(toXYZ(q.lon[i], q.lat[i], q.depth[i]), k * 3);
        col.set([c.r, c.g, c.b], k * 3);
        size[k] = 1.2 + Math.max(0, q.mag[i] - 5) ** 1.6 * 2.2; // M5 tiny, M8 large
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('size', new THREE.BufferAttribute(size, 1));
      const m = pointsMaterial();
      this.quakeMaterials.push(m);
      const pts = new THREE.Points(g, m);
      pts.renderOrder = 5;
      this.groups.set(`quakes${band}` as LayerName, pts);
      this.scene.add(pts);
    }
    this.resize();
  }

  setSlabs(slabs: Slab[]) {
    const g = new THREE.Group();
    const hitGeo = new THREE.SphereGeometry(0.022, 8, 6), hitMat = new THREE.MeshBasicMaterial({ visible: false });
    for (const s of slabs) {
      const color = isActive(s) ? SLAB_COLORS.active : SLAB_COLORS.sunk;
      const mid = V(toXYZ(s.mid[0], s.mid[1], s.mid[2]));
      const size = 0.0055 + Math.min(0.006, (s.base[0] - s.top[0]) / 6371 / 14);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 20, 14), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }));
      this.sliceMaterials.push(mesh.material as THREE.Material);
      mesh.position.copy(mid);
      // depth extent: a radial bar from the slab's top to its base, under its middle
      const barCurve = new THREE.LineCurve3(V(toXYZ(s.mid[0], s.mid[1], s.top[0])), V(toXYZ(s.mid[0], s.mid[1], s.base[0])));
      const bar = new THREE.Mesh(new THREE.TubeGeometry(barCurve, 1, 0.0028, 6, false), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }));
      // the way down: from where the rocks record the subduction at the surface to where the slab is now
      const a = V(toXYZ(s.surface[0], s.surface[1], 0)), steps = 40, pts: THREE.Vector3[] = [];
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        const p = new THREE.Vector3().copy(a).lerp(mid, f).normalize();
        pts.push(p.multiplyScalar(1 - (f * s.mid[2]) / 6371));
      }
      const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color, dashSize: 0.012, gapSize: 0.01, transparent: true, opacity: 0.45 }));
      path.computeLineDistances();
      this.sliceMaterials.push(bar.material as THREE.Material, path.material as THREE.Material);
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.position.copy(mid);
      hit.userData.slab = s;
      this.hitTargets.push(hit);
      g.add(mesh, bar, path, hit);
      this.slabMarkers.push({ slab: s, mesh, extras: [bar, path] });
    }
    this.groups.set('slabs', g);
    this.scene.add(g);
  }

  /** Slab2 surfaces, one mesh per subduction zone (positions already on the unit sphere, depth in a 4th channel). */
  setPlates(meshes: { name: string; positions: Float32Array; depths: Float32Array; index: Uint32Array }[]) {
    const g = new THREE.Group();
    const ramp = [new THREE.Color('#5fd3c6'), new THREE.Color('#3f8fd6'), new THREE.Color('#5a4fcf')]; // shallow -> 700 km
    for (const m of meshes) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      const col = new Float32Array(m.depths.length * 3), c = new THREE.Color();
      m.depths.forEach((d, i) => {
        const f = Math.min(1, d / 700) * 2, k = Math.min(1, Math.floor(f));
        c.copy(ramp[k]).lerp(ramp[k + 1], f - k);
        col.set([c.r, c.g, c.b], i * 3);
      });
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(new THREE.BufferAttribute(m.index, 1));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.82, roughness: 0.7 }));
      mesh.name = m.name;
      this.sliceMaterials.push(mesh.material);
      g.add(mesh);
    }
    this.groups.set('plates', g);
    this.scene.add(g);
  }

  /** Highlight what was going down at t million years ago; null shows everything. */
  setTime(t: number | null) {
    // today's earthquakes and plates say nothing about the past: fade them while looking back in time
    for (const m of this.quakeMaterials) m.uniforms.alpha.value = t == null ? 0.85 : 0.12;
    this.groups.get('plates')?.traverse((o) => { if ((o as THREE.Mesh).isMesh) ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = t == null ? 0.82 : 0.15; });
    for (const m of this.slabMarkers) {
      const on = t == null || sinkingAt(m.slab, t);
      (m.mesh.material as THREE.MeshBasicMaterial).opacity = on ? 0.95 : 0.12;
      m.mesh.scale.setScalar(on && t != null ? 1.35 : 1);
      for (const e of m.extras) (((e as THREE.Mesh).material) as THREE.MeshBasicMaterial).opacity = on ? 0.5 : 0.06;
    }
  }

  select(s: Slab | null, cut = true) {
    if (!s) {
      this.label.visible = false;
      this.setSection(null);
      this.flyTo(this.camera.position.clone().normalize().multiplyScalar(3.4), new THREE.Vector3());
      return;
    }
    this.label.element.textContent = s.name;
    const mid = V(toXYZ(s.mid[0], s.mid[1], s.mid[2]));
    this.label.position.copy(mid);
    this.label.visible = true;
    this.setSection(cut ? s.mid[0] : null);
    if (cut) {
      // put the boundary names on the cut, 25° of arc below the slab, where they do not cover it
      const inv = this.sectionArcs.quaternion.clone().invert();
      const dir = mid.clone().normalize().applyQuaternion(inv);
      const a = Math.atan2(dir.y, dir.x) - (25 * Math.PI) / 180;
      for (const o of this.arcLabels) o.position.set(Math.cos(a) * o.userData.r, Math.sin(a) * o.userData.r, 0);
    }
    // look at the cut face from the east, a little above, centred between the slab and the Earth's centre
    const lo = (s.mid[0] * Math.PI) / 180;
    const east = new THREE.Vector3(Math.cos(lo), 0, -Math.sin(lo));
    const up = mid.clone().normalize();
    // frame the slab with the surface above it: aim a little below its middle, from about 1.5 Earth radii away
    const target = mid.clone().multiplyScalar(Math.max(0.6, 0.97 - s.mid[2] / 6371));
    const cam = target.clone().add(east.multiplyScalar(cut ? 1.5 : 1.6)).add(up.multiplyScalar(cut ? 0.35 : 1.2));
    this.flyTo(cam, target);
  }

  /** Look at a point of the surface from above (orbiting the centre of the Earth). */
  flyTowards(lon: number, lat: number, dist = 2.6) {
    this.flyTo(V(toXYZ(lon, lat, 0)).multiplyScalar(dist), new THREE.Vector3());
  }

  private flyTo(to: THREE.Vector3, target: THREE.Vector3) {
    this.controls.autoRotate = false;
    this.flight = { from: this.camera.position.clone(), to, tFrom: this.controls.target.clone(), tTo: target, t0: performance.now(), ms: 1600 };
  }

  private pick(e: PointerEvent | MouseEvent): Slab | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    if (!this.groups.get('slabs')?.visible) return null;
    const hit = ray.intersectObjects(this.hitTargets, false)[0];
    return (hit?.object.userData.slab as Slab) ?? null;
  }
  private hover(e: PointerEvent) {
    const s = this.pick(e);
    this.renderer.domElement.style.cursor = s ? 'pointer' : 'grab';
    this.onHover(s);
  }
  private click(e: MouseEvent) { this.onPick(this.pick(e)); }

  /** Move the picture left by px (to make room for a side panel); 0 centres it again. */
  setViewShift(px: number) { this.viewShift = px; this.resize(); }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    if (this.viewShift) this.camera.setViewOffset(w + 2 * this.viewShift, h, 2 * this.viewShift, 0, w, h); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    for (const m of this.quakeMaterials) m.uniforms.scale.value = h / 280;
  }

  private frame() {
    if (this.flight) {
      const f = Math.min(1, (performance.now() - this.flight.t0) / this.flight.ms), e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
      // travel round the sphere, not through it
      const len = this.flight.from.length() + (this.flight.to.length() - this.flight.from.length()) * e;
      this.camera.position.copy(this.flight.from).normalize().lerp(this.flight.to.clone().normalize(), e).normalize().multiplyScalar(len);
      this.controls.target.lerpVectors(this.flight.tFrom, this.flight.tTo, e);
      if (f === 1) this.flight = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}
