// Spherical-Earth geometry. Pure functions, no three.js.
//
// Coordinate system: a sphere of radius R_KM = 6371 km (IUGG mean radius) scaled to 1. Latitudes are treated as
// geocentric; the catalogues (Atlas, Slab2, USGS) give WGS84 geodetic latitudes, which differ from geocentric by up to
// 0.19 deg (about 21 km) at 45 deg. That is below the Atlas depth/position errors (50-200 km) and below the 0.2 deg
// Slab2 thinning used here, and it is documented in the About dialog rather than corrected.
//
// Axes (three.js, y up): lon 0 / lat 0 on +z, lon 90 E on +x, north pole on +y.

export const R_KM = 6371;
export type Vec3 = [number, number, number];
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Unit-sphere position of lon/lat at a depth (km). */
export function toXYZ(lon: number, lat: number, depthKm = 0): Vec3 {
  const r = 1 - depthKm / R_KM, la = lat * D2R, lo = lon * D2R;
  return [r * Math.cos(la) * Math.sin(lo), r * Math.sin(la), r * Math.cos(la) * Math.cos(lo)];
}

/** Inverse of toXYZ. Safe at the centre (r = 0 gives lon = lat = 0, depth = R) and against |y/r| > 1 from rounding. */
export function fromXYZ(x: number, y: number, z: number): { lon: number; lat: number; depthKm: number } {
  const r = Math.hypot(x, y, z);
  if (!(r > 0)) return { lon: 0, lat: 0, depthKm: R_KM };
  return { lon: Math.atan2(x, z) * R2D, lat: Math.asin(clamp(y / r, -1, 1)) * R2D, depthKm: (1 - r) * R_KM };
}

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const unit = (a: Vec3): Vec3 => { const n = norm(a); return n > 0 ? scale(a, 1 / n) : [0, 0, 0]; };

/** Local east and north unit vectors at lon/lat. */
export function enu(lon: number, lat: number): { east: Vec3; north: Vec3; up: Vec3 } {
  const lo = lon * D2R, la = lat * D2R;
  return {
    east: [Math.cos(lo), 0, -Math.sin(lo)],
    north: [-Math.sin(la) * Math.sin(lo), Math.cos(la), -Math.sin(la) * Math.cos(lo)],
    up: [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)],
  };
}

/** Great-circle distance (km, at the surface) by the haversine formula. */
export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dp = p2 - p1, dl = (lon2 - lon1) * D2R;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(clamp(h, 0, 1)));
}

/** Initial bearing (deg clockwise from north) from point 1 to point 2 along the great circle. */
export function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Point reached from lon/lat after distKm along azimuth azDeg on the sphere. */
export function destination(lon: number, lat: number, azDeg: number, distKm: number): [number, number] {
  const d = distKm / R_KM, az = azDeg * D2R, p1 = lat * D2R, l1 = lon * D2R;
  const p2 = Math.asin(clamp(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(az), -1, 1));
  const l2 = l1 + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [((l2 * R2D + 540) % 360) - 180, p2 * R2D];
}

/** Spherical linear interpolation between two directions (any lengths; the result has unit length). */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const ua = unit(a), ub = unit(b), c = clamp(dot(ua, ub), -1, 1), om = Math.acos(c);
  if (om < 1e-9) return ua;
  const s = Math.sin(om);
  const k1 = Math.sin((1 - t) * om) / s, k2 = Math.sin(t * om) / s;
  return [ua[0] * k1 + ub[0] * k2, ua[1] * k1 + ub[1] * k2, ua[2] * k1 + ub[2] * k2];
}

/** Path from a surface point down to a point at depth: SLERP in direction, depth linear in arc fraction. */
export function descentPath(lon0: number, lat0: number, lon1: number, lat1: number, depth1Km: number, steps = 48): Vec3[] {
  const a = toXYZ(lon0, lat0, 0), b = toXYZ(lon1, lat1, 0), out: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    out.push(scale(slerp(a, b, f), 1 - (f * depth1Km) / R_KM));
  }
  return out;
}

/** Signed horizontal offset as a readable string, e.g. "1,234 km at N 35° E". */
export function compass(azDeg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round((((azDeg % 360) + 360) % 360) / 22.5) % 16];
}
