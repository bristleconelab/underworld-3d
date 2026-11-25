// Earth geometry and the data the globe shows. Pure, no three.js or DOM (test/earth.test.ts).
// The globe has radius 1; a point at depth d km sits at radius 1 - d / 6371.

export const R_KM = 6371;
/** Seismic boundaries (depth, km) drawn as faint shells. */
export const LAYERS = [
  { depth: 410, name: '410 km: olivine changes crystal form' },
  { depth: 660, name: '660 km: upper and lower mantle meet' },
  { depth: 2891, name: '2,891 km: the mantle ends, the liquid outer core begins' },
  { depth: 5150, name: '5,150 km: the solid inner core' },
];

/** Unit-sphere position of lon/lat at a depth. three.js has y up; lon 0 is on +z and lon 90° E on +x, so a camera on
 *  the +z axis looks at Africa. */
export function toXYZ(lon: number, lat: number, depthKm = 0): [number, number, number] {
  const r = 1 - depthKm / R_KM;
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  return [r * Math.cos(la) * Math.sin(lo), r * Math.sin(la), r * Math.cos(la) * Math.cos(lo)];
}

/** Inverse of toXYZ for a point on or inside the sphere. */
export function fromXYZ(x: number, y: number, z: number): { lon: number; lat: number; depthKm: number } {
  const r = Math.hypot(x, y, z);
  return { lon: (Math.atan2(x, z) * 180) / Math.PI, lat: (Math.asin(y / r) * 180) / Math.PI, depthKm: (1 - r) * R_KM };
}

// ---------- earthquakes (scripts/build_quakes.mjs) ----------
export interface Quakes { n: number; lon: Float32Array; lat: Float32Array; depth: Float32Array; mag: Float32Array; year: Uint16Array }
export function decodeQuakes(buf: ArrayBuffer, stride = 10): Quakes {
  const v = new DataView(buf);
  const n = Math.floor(buf.byteLength / stride);
  const q: Quakes = { n, lon: new Float32Array(n), lat: new Float32Array(n), depth: new Float32Array(n), mag: new Float32Array(n), year: new Uint16Array(n) };
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    q.lon[i] = v.getInt16(o, true) / 100;
    q.lat[i] = v.getInt16(o + 2, true) / 100;
    q.depth[i] = v.getUint16(o + 4, true) / 10;
    q.mag[i] = v.getUint8(o + 6) / 10;
    q.year[i] = 1900 + v.getUint8(o + 7);
  }
  return q;
}

/** Depth bands people can read: where the plate is still near the surface, half way down, deep. */
export const QUAKE_BANDS = [
  { max: 70, label: 'Shallow, 0–70 km', color: '#ffd166' },
  { max: 300, label: 'Intermediate, 70–300 km', color: '#ff8c42' },
  { max: 800, label: 'Deep, 300–700 km', color: '#e0559b' },
];
export function quakeBand(depthKm: number): number {
  return QUAKE_BANDS.findIndex((b) => depthKm < b.max);
}

// ---------- sunken slabs (scripts/build_atlas.py) ----------
export interface Slab {
  name: string;
  abbr: string;
  mid: [number, number, number];        // lon, lat, depth km of the slab's middle
  surface: [number, number];            // lon, lat of the geological record where it went down
  top: [number, number];                // depth km, error
  base: [number, number];
  ageBase: [number, number];            // Ma, min-max: when its deepest part went down
  ageTop: [number, number];             // Ma, min-max: when its shallowest part went down (0 = still going down)
  rate: [number | null, number | null]; // mm/yr
  ageNote?: string;
}

export const isActive = (s: Slab) => s.top[0] === 0 && s.ageTop[1] === 0;

/** "between 120 and 100 million years ago" / "since about 50 million years ago, and still going". */
export function sinkingStory(s: Slab): string {
  const old = Math.round(s.ageBase[1] ?? s.ageBase[0]);
  const young = Math.round(s.ageTop[0] ?? 0);
  if (isActive(s)) return `It has been going down since about ${fmt(old)} million years ago, and still is.`;
  if (old === young) return `It went down about ${fmt(old)} million years ago.`;
  return `It went down between about ${fmt(old)} and ${fmt(young)} million years ago.`;
}

/** Is any part of the slab going down at time t (Ma)? */
export function sinkingAt(s: Slab, t: number): boolean {
  const oldest = Math.max(s.ageBase[0] ?? 0, s.ageBase[1] ?? 0);
  const youngest = Math.min(s.ageTop[0] ?? 0, s.ageTop[1] ?? 0);
  return t <= oldest && t >= youngest;
}

/** A sinking rate in words, compared with something people know (fingernails grow about 3.5 mm a month = 42 mm/yr). */
export function rateWords(mmPerYear: number | null): string | null {
  if (mmPerYear == null || !(mmPerYear > 0)) return null;
  const ratio = mmPerYear / 42;
  const cmYr = mmPerYear / 10;
  const parts: Record<number, string> = { 3: 'third', 4: 'quarter', 5: 'fifth', 6: 'sixth', 7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth' };
  const comp = ratio < 0.4 ? `about a ${parts[Math.min(10, Math.round(1 / ratio))] ?? 'tenth'} of the speed fingernails grow` : ratio < 0.8 ? 'about half as fast as fingernails grow'
    : ratio < 1.3 ? 'about as fast as fingernails grow' : `about ${Math.round(ratio)} times as fast as fingernails grow`;
  return `${cmYr.toFixed(1)} cm a year, ${comp}`;
}

export const fmt = (n: number) => n.toLocaleString('en-US');
