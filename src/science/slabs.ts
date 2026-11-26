// The Atlas of the Underworld slab record (scripts/build_atlas.py) and what can be computed from it.

import { bearingDeg, haversineKm } from './geodesy';
import { meanSd, ols, type Fit } from './stats';

export interface Slab {
  nr: number;
  name: string;
  abbr: string;
  updated: string | null;
  mid: [number, number, number];          // lon, lat, depth km of the slab midpoint
  surface: [number, number] | null;       // lon, lat of the geological record of its subduction
  top: [number, number];                  // depth km, error km
  base: [number, number];
  ageBase: [number, number] | null;       // [young, old] Ma: onset of subduction (now at the base)
  ageTop: [number, number] | null;        // [young, old] Ma: end of subduction (0 = still subducting)
  rateBase: [number, number] | null;      // mm/yr = km/Myr, 1 sigma
  rateTop: [number, number] | null;
  ageNote?: string;
  topRateNote?: string;
}

export const mean2 = (r: [number, number]) => (r[0] + r[1]) / 2;

/** Still attached to the surface and subducting today (top at 0 km and 0 Ma). */
export const isActive = (s: Slab) => s.top[0] === 0 && s.ageTop?.[0] === 0;

/** Depth regime of the slab body. */
export function regime(s: Slab): 'upper mantle' | 'spans 660' | 'lower mantle' {
  if (s.base[0] <= 660) return 'upper mantle';
  return s.top[0] < 660 ? 'spans 660' : 'lower mantle';
}

/** Subduction interval [youngest, oldest] Ma: from the end (top age, young bound) to the onset (base age, old bound). */
export function interval(s: Slab): [number, number] | null {
  if (!s.ageBase || !s.ageTop) return null;
  return [Math.min(s.ageTop[0], s.ageBase[0]), Math.max(s.ageBase[1], s.ageTop[1])];
}

/** Was the slab subducting at t Ma (within its interval, both ends inclusive)? */
export function subductingAt(s: Slab, t: number): boolean {
  const iv = interval(s);
  return !!iv && t >= iv[0] && t <= iv[1];
}

/** Average sinking rate (km/Myr) of the base: the table value or, when it has none, base depth / mean base age. */
export function baseRate(s: Slab): number | null {
  if (s.rateBase) return s.rateBase[0];
  return s.ageBase ? s.base[0] / mean2(s.ageBase) : null;
}
export function topRate(s: Slab): number | null {
  if (isActive(s)) return 0;
  if (s.rateTop && s.top[0] > 0) return s.rateTop[0];
  return s.ageTop && s.top[0] > 0 ? s.top[0] / mean2(s.ageTop) : null;
}

/**
 * Kinematic back-advection under the Atlas's own assumption of vertical sinking at constant average rates:
 * depth(t) = max(0, depth_now - v t). Returns null when the slab had not started subducting (base above the surface)
 * or when no rate is known. Lateral plate motion is NOT reconstructed.
 */
export function depthsAt(s: Slab, t: number): { top: number; mid: number; base: number } | null {
  const vb = baseRate(s), vt = topRate(s);
  if (vb == null || vt == null) return null;
  const base = s.base[0] - vb * t;
  if (base <= 0) return null;
  const top = Math.max(0, s.top[0] - vt * t);
  return { top, base, mid: (top + base) / 2 };
}

/** Horizontal offset from the geological record at the surface to today's slab midpoint. */
export function surfaceOffset(s: Slab): { km: number; az: number } | null {
  if (!s.surface) return null;
  return { km: haversineKm(s.surface[0], s.surface[1], s.mid[0], s.mid[1]), az: bearingDeg(s.surface[0], s.surface[1], s.mid[0], s.mid[1]) };
}

/** Depth-versus-age points: each slab gives its base (onset age) and, if detached, its top (end age). */
export interface DepthAgePoint { abbr: string; part: 'base' | 'top'; age: number; ageLo: number; ageHi: number; depth: number; depthErr: number }
export function depthAgePoints(slabs: Slab[]): DepthAgePoint[] {
  const out: DepthAgePoint[] = [];
  for (const s of slabs) {
    if (s.ageBase) out.push({ abbr: s.abbr, part: 'base', age: mean2(s.ageBase), ageLo: s.ageBase[0], ageHi: s.ageBase[1], depth: s.base[0], depthErr: s.base[1] });
    if (s.ageTop && !isActive(s) && s.top[0] > 0) out.push({ abbr: s.abbr, part: 'top', age: mean2(s.ageTop), ageLo: s.ageTop[0], ageHi: s.ageTop[1], depth: s.top[0], depthErr: s.top[1] });
  }
  return out;
}

export interface SinkingAnalysis {
  lower: Fit | null;           // depth = v t through the origin, points deeper than 660 km: v in km/Myr = mm/yr
  upper: Fit | null;           // the same for points at or above 660 km
  lowerFree: Fit | null;       // depth = a + v t, points deeper than 660 km (a > 0: faster passage through the upper mantle)
  all: Fit | null;             // free intercept, all points
  lowerRates: { n: number; mean: number; sd: number };   // per-point depth / age, lower mantle
}
export function sinkingAnalysis(points: DepthAgePoint[]): SinkingAnalysis {
  const lo = points.filter((p) => p.depth > 660 && p.age > 0), up = points.filter((p) => p.depth <= 660 && p.age > 0);
  return {
    lower: ols(lo.map((p) => p.age), lo.map((p) => p.depth), true),
    upper: ols(up.map((p) => p.age), up.map((p) => p.depth), true),
    lowerFree: ols(lo.map((p) => p.age), lo.map((p) => p.depth)),
    all: ols(points.map((p) => p.age), points.map((p) => p.depth)),
    lowerRates: meanSd(lo.map((p) => p.depth / p.age)),
  };
}

/** Standard score of a slab's base rate against the lower-mantle population. */
export function rateZ(s: Slab, pop: { mean: number; sd: number }): number | null {
  return s.rateBase && pop.sd > 0 ? (s.rateBase[0] - pop.mean) / pop.sd : null;
}
