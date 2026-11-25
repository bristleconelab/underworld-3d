// USGS ComCat earthquakes, magnitude 5 and above since 1973 -> public/data/quakes.bin (+ quakes.json metadata).
// Public domain (U.S. Geological Survey). Fetched in 5-year windows to stay under the API's 20,000-row limit.
//
// Binary layout, little-endian, 10 bytes per event, sorted by depth so deep events draw last:
//   int16 lon*100, int16 lat*100, uint16 depth km*10, uint8 mag*10, uint8 year-1900
//
// usage: node scripts/build_quakes.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const START = 1973, END = new Date().getUTCFullYear() + 1, MINMAG = 5;
const API = 'https://earthquake.usgs.gov/fdsnws/event/1/query';

async function window(y0, y1) {
  const url = `${API}?format=csv&starttime=${y0}-01-01&endtime=${y1}-01-01&minmagnitude=${MINMAG}&orderby=time-asc&eventtype=earthquake`;
  const r = await fetch(url, { headers: { 'User-Agent': 'underworld-3d data build' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const lines = (await r.text()).trim().split('\n');
  if (lines.length - 1 >= 20000) throw new Error(`${y0}-${y1}: hit the 20,000-row limit, use smaller windows`);
  return lines.slice(1).map((l) => {
    const [time, lat, lon, depth, mag] = l.split(',');
    return { year: Number(time.slice(0, 4)), lat: Number(lat), lon: Number(lon), depth: Number(depth), mag: Number(mag) };
  });
}

const all = [];
for (let y = START; y < END; y += 5) all.push(...(await window(y, Math.min(y + 5, END))));
const ok = all.filter((q) => [q.lat, q.lon, q.depth, q.mag].every(Number.isFinite) && q.depth >= 0 && q.depth < 800);
ok.sort((a, b) => a.depth - b.depth);
const buf = Buffer.alloc(ok.length * 10);
ok.forEach((q, i) => {
  const o = i * 10;
  buf.writeInt16LE(Math.round(q.lon * 100), o);
  buf.writeInt16LE(Math.round(q.lat * 100), o + 2);
  buf.writeUInt16LE(Math.round(q.depth * 10), o + 4);
  buf.writeUInt8(Math.min(255, Math.round(q.mag * 10)), o + 6);
  buf.writeUInt8(Math.max(0, Math.min(255, q.year - 1900)), o + 7);
});
mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/quakes.bin', buf.subarray(0, ok.length * 10));
const deep = ok.filter((q) => q.depth >= 300).length;
writeFileSync('public/data/quakes.json', JSON.stringify({
  source: 'U.S. Geological Survey ComCat, https://earthquake.usgs.gov/fdsnws/event/1/ (public domain)',
  fetched: new Date().toISOString().slice(0, 10), minMagnitude: MINMAG, from: START, count: ok.length, deeperThan300km: deep,
  deepest: ok.at(-1).depth, stride: 10,
}));
console.log(`${ok.length} events (${deep} deeper than 300 km, deepest ${ok.at(-1).depth} km) -> public/data/quakes.bin`);
