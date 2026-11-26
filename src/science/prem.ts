// PREM, the Preliminary Reference Earth Model (Dziewonski & Anderson 1981, Phys. Earth Planet. Inter. 25, 297-356,
// doi:10.1016/0031-9201(81)90046-7), isotropic version, reference period 1 s.
// Density, Vp and Vs are the published polynomials in x = r / 6371 km. Gravity and pressure are integrated here from the
// density (hydrostatic, spherical), which reproduces the tabulated PREM values (CMB 135.8 GPa, centre 363.9 GPa).

import { R_KM } from './geodesy';

type Poly = [number, number?, number?, number?];
interface Region { r0: number; r1: number; name: string; rho: Poly; vp: Poly; vs: Poly }

// radii in km, bottom to top
const REGIONS: Region[] = [
  { r0: 0, r1: 1221.5, name: 'inner core', rho: [13.0885, 0, -8.8381], vp: [11.2622, 0, -6.364], vs: [3.6678, 0, -4.4475] },
  { r0: 1221.5, r1: 3480, name: 'outer core', rho: [12.5815, -1.2638, -3.6426, -5.5281], vp: [11.0487, -4.0362, 4.8023, -13.5732], vs: [0] },
  { r0: 3480, r1: 3630, name: "lower mantle (D'')", rho: [7.9565, -6.4761, 5.5283, -3.0807], vp: [15.3891, -5.3181, 5.5242, -2.5514], vs: [6.9254, 1.4672, -2.0834, 0.9783] },
  { r0: 3630, r1: 5600, name: 'lower mantle', rho: [7.9565, -6.4761, 5.5283, -3.0807], vp: [24.952, -40.4673, 51.4832, -26.6419], vs: [11.1671, -13.7818, 17.4575, -9.2777] },
  { r0: 5600, r1: 5701, name: 'lower mantle (top)', rho: [7.9565, -6.4761, 5.5283, -3.0807], vp: [29.2766, -23.6027, 5.5242, -2.5514], vs: [22.3459, -17.2473, -2.0834, 0.9783] },
  { r0: 5701, r1: 5771, name: 'transition zone', rho: [5.3197, -1.4836], vp: [19.0957, -9.8672], vs: [9.9839, -4.9324] },
  { r0: 5771, r1: 5971, name: 'transition zone', rho: [11.2494, -8.0298], vp: [39.7027, -32.6166], vs: [22.3512, -18.5856] },
  { r0: 5971, r1: 6151, name: 'upper mantle', rho: [7.1089, -3.8045], vp: [20.3926, -12.2569], vs: [8.9496, -4.4597] },
  { r0: 6151, r1: 6291, name: 'low-velocity zone', rho: [2.691, 0.6924], vp: [4.1875, 3.9382], vs: [2.1519, 2.3481] },
  { r0: 6291, r1: 6346.6, name: 'lid', rho: [2.691, 0.6924], vp: [4.1875, 3.9382], vs: [2.1519, 2.3481] },
  { r0: 6346.6, r1: 6356, name: 'lower crust', rho: [2.9], vp: [6.8], vs: [3.9] },
  { r0: 6356, r1: 6368, name: 'upper crust', rho: [2.6], vp: [5.8], vs: [3.2] },
  { r0: 6368, r1: 6371, name: 'ocean', rho: [1.02], vp: [1.45], vs: [0] },
];

const poly = (c: Poly, x: number) => c[0] + (c[1] ?? 0) * x + (c[2] ?? 0) * x * x + (c[3] ?? 0) * x * x * x;
const G = 6.6743e-11;

/** Region containing radius r. At a discontinuity, `below` picks the deeper side. */
function region(r: number, below = false): Region {
  for (const g of REGIONS) if (below ? r > g.r0 && r <= g.r1 : r >= g.r0 && r < g.r1) return g;
  return r <= 0 ? REGIONS[0] : REGIONS[REGIONS.length - 1];
}

/** Density (g/cm3), Vp, Vs (km/s) at depth (km). */
export function premLocal(depthKm: number, below = false) {
  const r = R_KM - depthKm, x = r / R_KM, g = region(r, below);
  return { rho: poly(g.rho, x), vp: poly(g.vp, x), vs: poly(g.vs, x), region: g.name };
}

// integrate mass outwards and pressure inwards on a 0.5 km grid
const STEP = 0.5, N = Math.round(R_KM / STEP);
const massAt = new Float64Array(N + 1), pressAt = new Float64Array(N + 1); // index i = radius i*STEP
(() => {
  for (let i = 1; i <= N; i++) {
    const rm = (i - 0.5) * STEP; // midpoint radius, km
    const rho = premLocal(R_KM - rm).rho * 1000; // kg/m3
    massAt[i] = massAt[i - 1] + 4 * Math.PI * (rm * 1e3) ** 2 * rho * STEP * 1e3;
  }
  for (let i = N - 1; i >= 0; i--) {
    const rm = (i + 0.5) * STEP;
    const rho = premLocal(R_KM - rm).rho * 1000;
    const m = (massAt[i] + massAt[i + 1]) / 2;
    const g = rm > 0 ? (G * m) / (rm * 1e3) ** 2 : 0;
    pressAt[i] = pressAt[i + 1] + rho * g * STEP * 1e3;
  }
})();
const interp = (a: Float64Array, r: number) => {
  const f = Math.min(N, Math.max(0, r / STEP)), i = Math.min(N - 1, Math.floor(f)), t = f - i;
  return a[i] * (1 - t) + a[i + 1] * t;
};

export interface PremPoint { depthKm: number; rho: number; vp: number; vs: number; gMs2: number; pGPa: number; region: string }
/** Everything PREM gives at a depth: rho (g/cm3), Vp/Vs (km/s), gravity (m/s2), pressure (GPa). */
export function prem(depthKm: number): PremPoint {
  const d = Math.min(R_KM, Math.max(0, depthKm)), r = R_KM - d;
  const loc = premLocal(d);
  const m = interp(massAt, r);
  return { depthKm: d, ...loc, gMs2: r > 0 ? (G * m) / (r * 1e3) ** 2 : 0, pGPa: interp(pressAt, r) / 1e9 };
}
export const earthMassKg = () => massAt[N];

/** Boundaries worth marking. `prem` = the PREM discontinuity depth where it differs from the seismological name. */
export const BOUNDARIES = [
  { depth: 24.4, name: 'Moho', note: 'PREM average; 5-10 km under oceans, 30-70 km under continents' },
  { depth: 80, name: 'LAB (PREM lid base)', note: 'lithosphere-asthenosphere boundary; varies 50-250 km' },
  { depth: 220, name: '220', note: 'PREM discontinuity (Lehmann), not global' },
  { depth: 410, name: '410', note: 'olivine to wadsleyite; PREM puts it at 400 km', prem: 400 },
  { depth: 520, name: '520', note: 'wadsleyite to ringwoodite; weak, not in PREM' },
  { depth: 660, name: '660', note: 'ringwoodite to bridgmanite + ferropericlase; PREM 670 km', prem: 670 },
  { depth: 1000, name: '~1,000', note: 'viscosity increase / slab stagnation level (e.g. Rudolph et al. 2015); not a PREM discontinuity' },
  { depth: 2741, name: "D''", note: 'top of the lowermost-mantle layer (PREM 2,741 km)' },
  { depth: 2891, name: 'CMB', note: 'core-mantle boundary' },
  { depth: 5150, name: 'ICB', note: 'inner-core boundary (PREM 5,149.5 km)' },
];

/** Clapeyron slopes (MPa/K), literature ranges, for the phase-boundary deflection calculator. */
export const CLAPEYRON = {
  410: { default: 3.0, range: [1.5, 4.0], ref: 'Bina & Helffrich 1994 (+2.9); Katsura et al. 2004 (+4.0)' },
  660: { default: -2.0, range: [-3.0, -0.5], ref: 'Ito & Takahashi 1989 (-2.8); Fei et al. 2004 (-1.3); Katsura et al. 2003 (-0.4 to -2.0)' },
} as const;

/** Depth change (km) of a phase boundary for a temperature anomaly dT (K): dz = gamma dT / (rho g), positive = deeper. */
export function phaseDeflectionKm(boundaryDepthKm: number, gammaMPaPerK: number, dTK: number): number {
  const p = prem(boundaryDepthKm);
  return (gammaMPaPerK * 1e6 * dTK) / (p.rho * 1000 * p.gMs2) / 1000;
}
