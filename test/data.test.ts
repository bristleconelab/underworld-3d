// Checks on the stored data files, so a rebuild that goes wrong fails here instead of on the globe.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeQuakes, type Slab } from '../src/earth';
import { HIGHLIGHTS } from '../src/tour';

const slabs = (JSON.parse(readFileSync('public/data/slabs.json', 'utf8')) as { slabs: Slab[] }).slabs;
const plates = JSON.parse(readFileSync('public/data/plates/index.json', 'utf8')) as { zones: { name: string; file: string; nv: number; nt: number; maxDepthKm: number }[] };

describe('slabs.json (Atlas of the Underworld)', () => {
  it('has the 100 slabs with sane depths and ages', () => {
    expect(slabs).toHaveLength(100);
    for (const s of slabs) {
      expect(s.top[0]).toBeGreaterThanOrEqual(0);
      expect(s.base[0]).toBeGreaterThan(s.top[0]);
      expect(s.base[0]).toBeLessThanOrEqual(2900);
      expect(s.mid[2]).toBeGreaterThanOrEqual(s.top[0]);
      expect(s.mid[2]).toBeLessThanOrEqual(s.base[0]);
      expect(Math.abs(s.mid[1])).toBeLessThanOrEqual(90);
      if (s.ageBase && s.ageTop) expect(s.ageBase[1]).toBeGreaterThanOrEqual(s.ageTop[0]);
      // 9999 is the table's "not estimated": it must become null, never a 9,999-million-year age or a 9999° position
      for (const v of [...s.mid, ...(s.surface ?? []), ...s.top, ...s.base, ...(s.ageBase ?? []), ...(s.ageTop ?? []), ...s.rate]) expect(v ?? 0, s.abbr).toBeLessThan(9999);
      for (const v of [...(s.ageBase ?? []), ...(s.ageTop ?? [])]) expect(v, s.abbr).toBeLessThanOrEqual(4540); // the age of the Earth
    }
    expect(new Set(slabs.map((s) => s.abbr)).size).toBe(slabs.length); // abbreviations are the deep-link keys
  });
  it('every highlight points at a slab', () => {
    for (const h of HIGHLIGHTS) expect(slabs.some((s) => s.abbr === h.abbr), h.abbr).toBe(true);
  });
});

describe('quakes.bin (USGS)', () => {
  it('decodes to M5+ events between 0 and 800 km, sorted by depth', () => {
    const b = readFileSync('public/data/quakes.bin');
    const q = decodeQuakes(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    expect(q.n).toBeGreaterThan(80000);
    for (let i = 0; i < q.n; i += 97) {
      expect(q.mag[i]).toBeGreaterThanOrEqual(5);
      expect(q.depth[i]).toBeLessThan(800);
      if (i) expect(q.depth[i]).toBeGreaterThanOrEqual(q.depth[i - 97]);
    }
  });
});

describe('plates (Slab2)', () => {
  it('has the 27 zones and files of the declared size', () => {
    expect(plates.zones).toHaveLength(27);
    for (const z of plates.zones) {
      const size = readFileSync(`public/data/plates/${z.file}`).byteLength;
      expect(size, z.name).toBe(z.nv * 16 + z.nt * 12);
      expect(z.maxDepthKm).toBeLessThan(800);
    }
  });
});
