// Uniform 3D hash grid over Slab2 vertices (km coordinates) for nearest-surface queries, and the signed distance of a
// hypocentre from the Slab2 slab-top surface.

import { R_KM, enu, fromXYZ, type Vec3 } from '../science/geodesy';
import type { PlateMesh } from './decode';

export interface SlabHit {
  zone: string; vertexDepth: number; dip: number; dipAz: number;
  /** signed km, + above the slab top (toward the surface), - below it */ distKm: number; horizKm: number;
  thkKm: number; uncKm: number;
}

export type SlabRelation = 'top' | 'within' | 'above' | 'below';
/** Where a hypocentre sits relative to the Slab2 slab: within 1 sigma of the slab top, inside the slab (down to its
 *  thickness), above it (upper plate / mantle wedge) or beneath it. */
export function slabRelation(h: SlabHit): SlabRelation {
  if (Math.abs(h.distKm) <= h.uncKm) return 'top';
  if (h.distKm > 0) return 'above';
  return -h.distKm <= h.thkKm ? 'within' : 'below';
}
export const RELATION_LABEL: Record<SlabRelation, string> = {
  top: 'at the slab top (within ±1σ): interface or uppermost slab', within: 'inside the slab (intraslab)',
  above: 'above the slab top (upper plate or mantle wedge)', below: 'beneath the slab',
};

export class SlabIndex {
  private cells = new Map<string, number[]>();
  private pts: Float32Array; private zone: Uint16Array; private depth: Float32Array; private dip: Float32Array; private dipAz: Float32Array; private thk: Float32Array; private unc: Float32Array;
  readonly zones: string[];
  constructor(meshes: PlateMesh[], private cellKm = 100) {
    const n = meshes.reduce((a, m) => a + m.depths.length, 0);
    this.pts = new Float32Array(n * 3); this.zone = new Uint16Array(n); this.depth = new Float32Array(n);
    this.dip = new Float32Array(n); this.dipAz = new Float32Array(n); this.thk = new Float32Array(n); this.unc = new Float32Array(n); this.zones = meshes.map((m) => m.name);
    let k = 0;
    meshes.forEach((m, zi) => {
      for (let i = 0; i < m.depths.length; i++, k++) {
        for (let c = 0; c < 3; c++) this.pts[k * 3 + c] = m.positions[i * 3 + c] * R_KM;
        this.zone[k] = zi; this.depth[k] = m.depths[i]; this.dip[k] = m.dip[i]; this.dipAz[k] = m.dipAz[i]; this.thk[k] = m.thk[i]; this.unc[k] = m.unc[i];
        const key = this.key(this.pts[k * 3], this.pts[k * 3 + 1], this.pts[k * 3 + 2]);
        let cell = this.cells.get(key); if (!cell) this.cells.set(key, (cell = [])); cell.push(k);
      }
    });
  }
  private key(x: number, y: number, z: number) { return `${Math.floor(x / this.cellKm)},${Math.floor(y / this.cellKm)},${Math.floor(z / this.cellKm)}`; }

  /** Nearest Slab2 vertex within maxKm of a unit-sphere point, with the signed distance from the local slab-top plane. */
  nearest(p: Vec3, maxKm = 150): SlabHit | null {
    const x = p[0] * R_KM, y = p[1] * R_KM, z = p[2] * R_KM, c = this.cellKm, r = Math.ceil(maxKm / c);
    const cx = Math.floor(x / c), cy = Math.floor(y / c), cz = Math.floor(z / c);
    let best = -1, bd = maxKm * maxKm;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
      const cell = this.cells.get(`${cx + i},${cy + j},${cz + k}`);
      if (!cell) continue;
      for (const v of cell) {
        const d = (this.pts[v * 3] - x) ** 2 + (this.pts[v * 3 + 1] - y) ** 2 + (this.pts[v * 3 + 2] - z) ** 2;
        if (d < bd) { bd = d; best = v; }
      }
    }
    if (best < 0) return null;
    const vx = this.pts[best * 3], vy = this.pts[best * 3 + 1], vz = this.pts[best * 3 + 2];
    const ll = fromXYZ(vx, vy, vz);
    const { east, north, up } = enu(ll.lon, ll.lat);
    const dip = this.dip[best], az = this.dipAz[best];
    // upward normal of the slab-top surface: depth grows along az with slope tan(dip)
    const t = Math.tan((dip * Math.PI) / 180), a = (az * Math.PI) / 180;
    const ne = az >= 0 ? t * Math.sin(a) : 0, nn = az >= 0 ? t * Math.cos(a) : 0, len = Math.hypot(ne, nn, 1);
    const nrm: Vec3 = [(east[0] * ne + north[0] * nn + up[0]) / len, (east[1] * ne + north[1] * nn + up[1]) / len, (east[2] * ne + north[2] * nn + up[2]) / len];
    const dx = x - vx, dy = y - vy, dz = z - vz;
    const signed = dx * nrm[0] + dy * nrm[1] + dz * nrm[2];
    return { zone: this.zones[this.zone[best]], vertexDepth: this.depth[best], dip, dipAz: az, distKm: signed, horizKm: Math.sqrt(Math.max(0, bd - signed * signed)), thkKm: this.thk[best], uncKm: this.unc[best] };
  }
}
