// Small statistics: ordinary least squares with confidence intervals, means, circular mean.

/** Two-sided 95% Student t quantile for df degrees of freedom (table to 30, then normal-limit series). */
export function t95(df: number): number {
  const T = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
  if (df < 1) return NaN;
  if (df <= 30) return T[Math.round(df)];
  const z = 1.959964; // Cornish-Fisher expansion
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df);
}

export interface Fit { n: number; slope: number; intercept: number; slopeSE: number; interceptSE: number; slopeCI95: [number, number]; r2: number; rmse: number; throughOrigin: boolean }

/** OLS y = a + b x (or y = b x with throughOrigin). */
export function ols(x: number[], y: number[], throughOrigin = false): Fit | null {
  const n = x.length;
  if (n < (throughOrigin ? 2 : 3) || n !== y.length) return null;
  let slope: number, intercept = 0, slopeSE: number, interceptSE = 0, sse = 0;
  const my = y.reduce((a, b) => a + b, 0) / n;
  if (throughOrigin) {
    const sxx = x.reduce((a, v) => a + v * v, 0), sxy = x.reduce((a, v, i) => a + v * y[i], 0);
    if (!(sxx > 0)) return null;
    slope = sxy / sxx;
    for (let i = 0; i < n; i++) sse += (y[i] - slope * x[i]) ** 2;
    slopeSE = Math.sqrt(sse / (n - 1) / sxx);
  } else {
    const mx = x.reduce((a, b) => a + b, 0) / n;
    let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); }
    if (!(sxx > 0)) return null;
    slope = sxy / sxx; intercept = my - slope * mx;
    for (let i = 0; i < n; i++) sse += (y[i] - intercept - slope * x[i]) ** 2;
    const s2 = sse / (n - 2);
    slopeSE = Math.sqrt(s2 / sxx); interceptSE = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx));
  }
  const df = n - (throughOrigin ? 1 : 2), t = t95(df);
  const sst = y.reduce((a, v) => a + (v - my) ** 2, 0);
  return { n, slope, intercept, slopeSE, interceptSE, slopeCI95: [slope - t * slopeSE, slope + t * slopeSE], r2: sst > 0 ? 1 - sse / sst : NaN, rmse: Math.sqrt(sse / n), throughOrigin };
}

export function meanSd(v: number[]): { n: number; mean: number; sd: number } {
  const n = v.length;
  if (!n) return { n, mean: NaN, sd: NaN };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  return { n, mean, sd: n > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : NaN };
}

/** Mean direction of angles in degrees and the resultant length (1 = all identical, 0 = spread evenly). */
export function circularMean(deg: number[]): { mean: number; R: number } {
  if (!deg.length) return { mean: NaN, R: 0 };
  let s = 0, c = 0;
  for (const d of deg) { s += Math.sin((d * Math.PI) / 180); c += Math.cos((d * Math.PI) / 180); }
  s /= deg.length; c /= deg.length;
  return { mean: ((Math.atan2(s, c) * 180) / Math.PI + 360) % 360, R: Math.hypot(s, c) };
}

export function histogram(values: ArrayLike<number>, lo: number, hi: number, binWidth: number): { edges: number[]; counts: number[] } {
  const nb = Math.max(1, Math.ceil((hi - lo) / binWidth)), counts = new Array(nb).fill(0), edges: number[] = [];
  for (let i = 0; i <= nb; i++) edges.push(lo + i * binWidth);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v >= lo && v < hi) counts[Math.min(nb - 1, Math.floor((v - lo) / binWidth))]++;
  }
  return { edges, counts };
}
