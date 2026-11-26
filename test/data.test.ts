// Checks on the stored data files, so a rebuild that goes wrong fails here instead of on the globe.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeBoundaries, decodePlate, decodeQuakes, QUAKE_STRIDE } from '../src/data/decode';
import { slabProblems, validateQuakes, validateSlabs } from '../src/data/schema';
import { mean2, type Slab } from '../src/science/slabs';

const ab = (p: string) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const sj = JSON.parse(readFileSync('public/data/slabs.json', 'utf8')) as { slabs: Slab[]; rateCheck: { abbr: string }[]; sourceSha256: string };
const slabs = sj.slabs;
const byAbbr = new Map(slabs.map((s) => [s.abbr, s]));
const plates = JSON.parse(readFileSync('public/data/plates/index.json', 'utf8')) as { zones: { name: string; file: string; nv: number; nt: number; maxDepthKm: number }[]; atlas: Record<string, { zone: string; dipAz: number | null }> };
const qmeta = JSON.parse(readFileSync('public/data/quakes.json', 'utf8'));

describe('slabs.json (Atlas of the Underworld)', () => {
  it('has the 100 slabs and passes every runtime check', () => {
    expect(slabs).toHaveLength(100);
    expect(validateSlabs(slabs)).toEqual([]);
    expect(sj.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('turns the 9999 "not estimated" sentinel into null everywhere (Maldives)', () => {
    const md = byAbbr.get('Md')!;
    expect(md.surface).toBeNull(); expect(md.ageBase).toBeNull(); expect(md.ageTop).toBeNull();
    expect(md.rateBase).toBeNull(); expect(md.rateTop).toBeNull();
    expect(JSON.stringify(slabs)).not.toMatch(/9999/);
  });
  it('stores every age range as [young, old] (India top 35-50 Ma, Anhui 52-90 Ma, Zagros 0.5-10 Ma)', () => {
    expect(byAbbr.get('In')!.ageTop).toEqual([35, 50]); expect(byAbbr.get('In')!.ageBase).toEqual([120, 140]);
    expect(byAbbr.get('Anh')!.ageTop).toEqual([52, 90]);
    expect(byAbbr.get('Za')!.ageTop).toEqual([0.5, 10]);
    expect(byAbbr.get('Gb-B')!.ageTop).toEqual([0.5, 7]);
    expect(byAbbr.get('Te-C')!.ageBase).toEqual([201.4, 251.9]); // Triassic, ICS 2023/09
    expect(byAbbr.get('Te-C')!.ageTop).toEqual([100.5, 145]);   // Early Cretaceous
  });
  it('keeps the rate errors and drops the table blanks (rate 0 with no age)', () => {
    expect(byAbbr.get('Aeg')!.rateBase).toEqual([12.73, 1.47]);
    for (const a of ['Te-C', 'Te-N', 'Te-S', 'Md']) expect(byAbbr.get(a)!.rateTop, a).toBeNull();
  });
  it('base rate = base depth / mean base age within 5%, except the cases the build lists', () => {
    const listed = new Set(sj.rateCheck.map((c) => c.abbr));
    for (const s of slabs) {
      if (!s.rateBase || !s.ageBase || listed.has(s.abbr)) continue;
      const implied = s.base[0] / mean2(s.ageBase);
      expect(Math.abs(implied - s.rateBase[0]) / implied, s.abbr).toBeLessThan(0.05);
    }
    expect([...listed].sort()).toEqual(['Agt', 'Mn']);
  });
  it('rejects broken records', () => {
    const bad = { ...byAbbr.get('In')!, surface: [9999, 9999] as [number, number], ageTop: [50, 35] as [number, number] };
    expect(slabProblems(bad).length).toBeGreaterThanOrEqual(2);
    expect(slabProblems({ ...byAbbr.get('In')!, top: [2300, 100] })).not.toEqual([]);
  });
});

describe('quakes.bin (USGS ComCat)', () => {
  const q = decodeQuakes(ab('public/data/quakes.bin'), qmeta.magTypes);
  it('is a whole number of 16-byte records and matches its metadata', () => {
    expect(readFileSync('public/data/quakes.bin').byteLength).toBe(qmeta.count * QUAKE_STRIDE);
    expect(q.n).toBe(qmeta.count);
    expect(q.n).toBeGreaterThan(89000);
    expect(readFileSync('public/data/quakes_ids.txt', 'utf8').split('\n')).toHaveLength(q.n);
  });
  it('passes the runtime checks: positions, 0-800 km, M>=5, years, depth order', () => {
    expect(validateQuakes(q)).toEqual([]);
  });
  it('carries times, magnitude types and errors', () => {
    let withErr = 0, mw = 0;
    for (let i = 0; i < q.n; i++) { if (Number.isFinite(q.depthErr[i])) withErr++; if (q.magTypes[q.magType[i]].startsWith('mw')) mw++; }
    expect(withErr / q.n).toBeGreaterThan(0.3);
    expect(mw / q.n).toBeGreaterThan(0.3);
    expect(Math.min(...q.year.subarray(0, 5000))).toBeGreaterThanOrEqual(1973);
  });
});

describe('plates (Slab2)', () => {
  it('has the 27 zones, files of the declared size and sane dips', () => {
    expect(plates.zones).toHaveLength(27);
    for (const z of plates.zones) {
      const m = decodePlate(z.name, ab(`public/data/plates/${z.file}`), z.nv, z.nt);
      expect(z.maxDepthKm, z.name).toBeLessThan(800);
      for (let i = 0; i < m.dip.length; i += 37) { expect(m.dip[i]).toBeGreaterThanOrEqual(0); expect(m.dip[i]).toBeLessThan(90); }
      for (let i = 0; i < m.index.length; i++) expect(m.index[i]).toBeLessThan(z.nv);
    }
  });
  it('cross-references Atlas slabs with plausible down-dip directions', () => {
    // Tonga-Kermadec dips west, Cascadia east, Java north, Mariana west
    const az = (a: string) => plates.atlas[a].dipAz!;
    expect(plates.atlas.TKH.zone).toBe('Kermadec'); expect(az('TKH')).toBeGreaterThan(250); expect(az('TKH')).toBeLessThan(310);
    expect(az('JdF')).toBeGreaterThan(50); expect(az('JdF')).toBeLessThan(110);
    expect(Math.min(az('Su'), 360 - az('Su'))).toBeLessThan(40);
    expect(az('Mr')).toBeGreaterThan(250); expect(az('Mr')).toBeLessThan(310);
  });
});

describe('pb2002.bin (Bird 2003)', () => {
  const meta = JSON.parse(readFileSync('public/data/pb2002.json', 'utf8'));
  const b = decodeBoundaries(ab('public/data/pb2002.bin'), meta.classes, meta.pairs);
  it('has 5,824 steps; subduction steps converge', () => {
    expect(b.n).toBe(5824);
    const sub = meta.classes.findIndex((c: string[]) => c[0] === 'SUB');
    const divs = [...b.div].filter((_, i) => b.cls[i] === sub).sort((x, y) => x - y);
    expect(divs[Math.floor(divs.length / 2)]).toBeLessThan(0);
  });
});
