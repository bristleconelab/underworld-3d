// Seismic moment, magnitude-frequency statistics and symbol scaling.

/** Scalar seismic moment (N m) from moment magnitude: M0 = 10^(1.5 Mw + 9.1) (IASPEI 2013; Hanks & Kanamori 1979). */
export const momentFromMw = (mw: number) => 10 ** (1.5 * mw + 9.1);
/** Moment magnitude of a moment (N m). */
export const mwFromMoment = (m0: number) => (Math.log10(m0) - 9.1) / 1.5;

/** USGS magnitude types that are moment magnitudes. mb saturates near 6-6.5 and Ms near 8, so their "M0" is a lower bound. */
export const isMomentMagnitude = (t: string) => t.startsWith('mw') || t === 'mww';

export interface MomentSum { n: number; sumM0: number; mwEquivalent: number; fractionMw: number }
export function momentSum(mags: ArrayLike<number>, types?: ArrayLike<string>): MomentSum {
  let sum = 0, mw = 0;
  for (let i = 0; i < mags.length; i++) { sum += momentFromMw(mags[i]); if (types && isMomentMagnitude(types[i])) mw++; }
  return { n: mags.length, sumM0: sum, mwEquivalent: mags.length ? mwFromMoment(sum) : NaN, fractionMw: mags.length ? mw / mags.length : NaN };
}

export interface BValue { n: number; mc: number; b: number; sigma: number; a: number }
/**
 * Gutenberg-Richter b-value, log10 N(>=M) = a - b M, by maximum likelihood (Aki 1965) with Utsu's binning correction:
 * b = log10(e) / (mean(M) - (Mc - dM/2)). Mc by maximum curvature + 0.2 (Woessner & Wiemer 2005). sigma after
 * Shi & Bolt (1982). Returns null for fewer than minN events above Mc.
 */
export function bValue(mags: ArrayLike<number>, dM = 0.1, minN = 50, mcFloor = -Infinity): BValue | null {
  if (mags.length < minN) return null;
  const counts = new Map<number, number>();
  for (let i = 0; i < mags.length; i++) { const k = Math.round(mags[i] / dM); counts.set(k, (counts.get(k) ?? 0) + 1); }
  let modeK = 0, best = -1;
  for (const [k, c] of counts) if (c > best || (c === best && k < modeK)) { best = c; modeK = k; }
  const mc = Math.max(mcFloor, Math.round((modeK * dM + 0.2) / dM) * dM);
  const above: number[] = [];
  for (let i = 0; i < mags.length; i++) if (mags[i] >= mc - dM / 2 - 1e-9) above.push(mags[i]);
  const n = above.length;
  if (n < minN) return null;
  const mean = above.reduce((a, b) => a + b, 0) / n;
  const b = Math.LOG10E / (mean - (mc - dM / 2));
  const v = above.reduce((a, m) => a + (m - mean) ** 2, 0) / (n * (n - 1));
  return { n, mc, b, sigma: 2.3 * b * b * Math.sqrt(v), a: Math.log10(n) + b * mc };
}

/** Cumulative frequency-magnitude distribution: for each magnitude bin, the number of events >= that magnitude. */
export function cumulativeFmd(mags: ArrayLike<number>, dM = 0.1): { m: number[]; n: number[] } {
  const ks = Array.from(mags, (x) => Math.round(x / dM)).sort((a, b) => a - b);
  const m: number[] = [], n: number[] = [];
  for (let i = 0; i < ks.length; ) {
    let j = i; while (j < ks.length && ks[j] === ks[i]) j++;
    m.push(+(ks[i] * dM).toFixed(2)); n.push(ks.length - i); i = j;
  }
  return { m, n };
}

/**
 * Symbol diameter (px) for a magnitude. Diameter grows as 10^(0.25 (M - 5)), so the symbol AREA is proportional to
 * M0^(1/3), i.e. to rupture radius for a constant stress drop (Eshelby/Kanamori & Anderson 1975 scaling). Clamped so
 * M5 stays visible and great earthquakes do not cover a region.
 */
export function magnitudeDiameterPx(m: number, base = 2.2, minPx = 1.5, maxPx = 22): number {
  return Math.min(maxPx, Math.max(minPx, base * 10 ** (0.25 * (m - 5))));
}
