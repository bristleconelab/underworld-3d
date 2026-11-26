// Binary decoders for the files written by scripts/build_*.{py,mjs}. Layouts are documented in those scripts.

export const QUAKE_STRIDE = 16;
export const ERR_NONE = 65535;

export interface Quakes {
  n: number;
  lon: Float32Array; lat: Float32Array; depth: Float32Array; mag: Float32Array;
  magType: Uint8Array; time: Float64Array; /** seconds since 1970 UTC */
  year: Float32Array; /** decimal year */
  depthErr: Float32Array; horErr: Float32Array; /** km, NaN = not reported */
  magTypes: string[];
}

export function decodeQuakes(buf: ArrayBuffer, magTypes: string[] = []): Quakes {
  if (buf.byteLength % QUAKE_STRIDE) throw new Error(`quakes.bin: ${buf.byteLength} bytes is not a multiple of ${QUAKE_STRIDE}`);
  const v = new DataView(buf), n = buf.byteLength / QUAKE_STRIDE;
  const q: Quakes = {
    n, lon: new Float32Array(n), lat: new Float32Array(n), depth: new Float32Array(n), mag: new Float32Array(n), magType: new Uint8Array(n),
    time: new Float64Array(n), year: new Float32Array(n), depthErr: new Float32Array(n), horErr: new Float32Array(n), magTypes,
  };
  const Y = 365.2425 * 86400;
  for (let i = 0; i < n; i++) {
    const o = i * QUAKE_STRIDE;
    q.lon[i] = v.getInt16(o, true) / 100;
    q.lat[i] = v.getInt16(o + 2, true) / 100;
    q.depth[i] = v.getUint16(o + 4, true) / 10;
    q.mag[i] = v.getUint8(o + 6) / 10;
    q.magType[i] = v.getUint8(o + 7);
    q.time[i] = v.getUint32(o + 8, true);
    q.year[i] = 1970 + q.time[i] / Y;
    const de = v.getUint16(o + 12, true), he = v.getUint16(o + 14, true);
    q.depthErr[i] = de === ERR_NONE ? NaN : de / 10;
    q.horErr[i] = he === ERR_NONE ? NaN : he / 10;
  }
  return q;
}

export interface PlateMesh {
  name: string; positions: Float32Array; depths: Float32Array; dip: Float32Array; dipAz: Float32Array;
  /** slab thickness perpendicular to the slab (km) and 1-sigma depth uncertainty of the slab top (km), Slab2 thk/unc grids */
  thk: Float32Array; unc: Float32Array; index: Uint32Array;
}
export function decodePlate(name: string, buf: ArrayBuffer, nv: number, nt: number): PlateMesh {
  const want = nv * 32 + nt * 12;
  if (buf.byteLength !== want) throw new Error(`${name}: ${buf.byteLength} bytes, expected ${want}`);
  return {
    name,
    positions: new Float32Array(buf, 0, nv * 3), depths: new Float32Array(buf, nv * 12, nv),
    dip: new Float32Array(buf, nv * 16, nv), dipAz: new Float32Array(buf, nv * 20, nv),
    thk: new Float32Array(buf, nv * 24, nv), unc: new Float32Array(buf, nv * 28, nv), index: new Uint32Array(buf, nv * 32, nt * 3),
  };
}

export const PB_STRIDE = 20;
export interface Boundaries {
  n: number; lon0: Float32Array; lat0: Float32Array; lon1: Float32Array; lat1: Float32Array; cls: Uint8Array;
  vel: Float32Array; velAz: Float32Array; div: Float32Array; rl: Float32Array; pair: Uint16Array;
  classes: [string, string][]; pairs: string[];
}
export function decodeBoundaries(buf: ArrayBuffer, classes: [string, string][], pairs: string[]): Boundaries {
  if (buf.byteLength % PB_STRIDE) throw new Error('pb2002.bin: bad length');
  const v = new DataView(buf), n = buf.byteLength / PB_STRIDE;
  const f = () => new Float32Array(n);
  const b: Boundaries = { n, lon0: f(), lat0: f(), lon1: f(), lat1: f(), cls: new Uint8Array(n), vel: f(), velAz: f(), div: f(), rl: f(), pair: new Uint16Array(n), classes, pairs };
  for (let i = 0; i < n; i++) {
    const o = i * PB_STRIDE;
    b.lon0[i] = v.getInt16(o, true) / 100; b.lat0[i] = v.getInt16(o + 2, true) / 100;
    b.lon1[i] = v.getInt16(o + 4, true) / 100; b.lat1[i] = v.getInt16(o + 6, true) / 100;
    b.cls[i] = v.getUint8(o + 8);
    b.vel[i] = v.getUint16(o + 10, true) / 10; b.velAz[i] = v.getUint16(o + 12, true) / 10;
    b.div[i] = v.getInt16(o + 14, true) / 10; b.rl[i] = v.getInt16(o + 16, true) / 10;
    b.pair[i] = v.getUint16(o + 18, true);
  }
  return b;
}
