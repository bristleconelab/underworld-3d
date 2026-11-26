// USGS ComCat earthquakes, magnitude 5 and above since 1973 -> public/data/quakes.bin, quakes_ids.txt, quakes.json.
// Public domain (U.S. Geological Survey). Fetched in 5-year windows to stay under the API's 20,000-row limit.
//
// quakes.bin, little-endian, 16 bytes per event, sorted by depth (deep events draw last):
//   0 int16  lon * 100            2 int16  lat * 100           4 uint16 depth km * 10
//   6 uint8  mag * 10             7 uint8  magType index (quakes.json magTypes)
//   8 uint32 origin time, seconds since 1970-01-01 UTC
//  12 uint16 depthError km * 10 (65535 = not reported)
//  14 uint16 horizontalError km * 10 (65535 = not reported)
// quakes_ids.txt: one USGS event id per line, same order (loaded only when an event is inspected).
//
// usage: node scripts/build_quakes.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';

const START = 1973, END = new Date().getUTCFullYear() + 1, MINMAG = 5, STRIDE = 16, NONE = 65535;
const API = 'https://earthquake.usgs.gov/fdsnws/event/1/query';

/** Minimal CSV line split (USGS quotes the place field, which may contain commas). */
export function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

async function window(y0, y1) {
  const url = `${API}?format=csv&starttime=${y0}-01-01&endtime=${y1}-01-01&minmagnitude=${MINMAG}&orderby=time-asc&eventtype=earthquake`;
  const r = await fetch(url, { headers: { 'User-Agent': 'underworld-3d data build' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const text = await r.text();
  const lines = text.trim().split('\n');
  const head = splitCsv(lines[0]), col = (n) => { const i = head.indexOf(n); if (i < 0) throw new Error(`no column ${n}`); return i; };
  const C = { time: col('time'), lat: col('latitude'), lon: col('longitude'), depth: col('depth'), mag: col('mag'), magType: col('magType'), id: col('id'), dErr: col('depthError'), hErr: col('horizontalError') };
  if (lines.length - 1 >= 20000) throw new Error(`${y0}-${y1}: hit the 20,000-row limit, use smaller windows`);
  return { raw: text, rows: lines.slice(1).map((l) => {
    const f = splitCsv(l), n = (k) => (f[C[k]] === '' ? NaN : Number(f[C[k]]));
    return { t: Date.parse(f[C.time]) / 1000, lat: n('lat'), lon: n('lon'), depth: n('depth'), mag: n('mag'), magType: (f[C.magType] || '?').toLowerCase(), id: f[C.id], dErr: n('dErr'), hErr: n('hErr') };
  }) };
}

async function main() {
  const all = [], hash = createHash('sha256');
  for (let y = START; y < END; y += 5) {
    const w = await window(y, Math.min(y + 5, END));
    hash.update(w.raw);
    all.push(...w.rows);
    console.log(`${y}-${Math.min(y + 5, END)}: ${w.rows.length}`);
  }
  const bad = all.filter((q) => ![q.lat, q.lon, q.depth, q.mag, q.t].every(Number.isFinite));
  const above = all.filter((q) => Number.isFinite(q.depth) && q.depth < 0);
  // events located above sea level (negative depth, a few km at most) are kept at 0 km and counted
  const ok = all.filter((q) => [q.lat, q.lon, q.depth, q.mag, q.t].every(Number.isFinite) && q.depth < 800);
  ok.sort((a, b) => a.depth - b.depth || a.t - b.t);
  const magTypes = [...new Set(ok.map((q) => q.magType))].sort();
  const buf = Buffer.alloc(ok.length * STRIDE);
  const err = (x) => (Number.isFinite(x) && x >= 0 ? Math.min(NONE - 1, Math.round(x * 10)) : NONE);
  ok.forEach((q, i) => {
    const o = i * STRIDE;
    buf.writeInt16LE(Math.round(q.lon * 100), o);
    buf.writeInt16LE(Math.round(q.lat * 100), o + 2);
    buf.writeUInt16LE(Math.round(Math.max(0, q.depth) * 10), o + 4);
    buf.writeUInt8(Math.min(255, Math.round(q.mag * 10)), o + 6);
    buf.writeUInt8(magTypes.indexOf(q.magType), o + 7);
    buf.writeUInt32LE(Math.max(0, Math.round(q.t)), o + 8);
    buf.writeUInt16LE(err(q.dErr), o + 12);
    buf.writeUInt16LE(err(q.hErr), o + 14);
  });
  mkdirSync('public/data', { recursive: true });
  writeFileSync('public/data/quakes.bin', buf);
  writeFileSync('public/data/quakes_ids.txt', ok.map((q) => q.id).join('\n'));
  const deep = ok.filter((q) => q.depth >= 300).length;
  const meta = {
    source: 'U.S. Geological Survey ComCat, https://earthquake.usgs.gov/fdsnws/event/1/ (public domain)',
    fetched: new Date().toISOString().slice(0, 10), minMagnitude: MINMAG, from: START, count: ok.length, deeperThan300km: deep,
    deepest: ok.at(-1).depth, stride: STRIDE, magTypes, responseSha256: hash.digest('hex'),
    dropped: { missingField: bad.length }, aboveSeaLevelSetTo0km: above.length,
  };
  writeFileSync('public/data/quakes.json', JSON.stringify(meta));
  console.log(JSON.stringify(meta));
}

// run only when invoked as a script (the tests import splitCsv)
if (process.argv[1] && import.meta.url === `file://${realpathSync(process.argv[1])}`) await main();
