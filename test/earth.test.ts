import { describe, expect, it } from 'vitest';
import { decodeQuakes, fromXYZ, isActive, quakeBand, rateWords, sinkingAt, sinkingStory, toXYZ, type Slab } from '../src/earth';

describe('coordinates', () => {
  it('puts lon 0 / lat 0 on +z and lon 90 E on +x, north on +y', () => {
    expect(toXYZ(0, 0)).toEqual([0, 0, 1]);
    const e = toXYZ(90, 0); expect(e[0]).toBeCloseTo(1); expect(e[2]).toBeCloseTo(0);
    expect(toXYZ(0, 90)[1]).toBeCloseTo(1);
  });
  it('shrinks the radius with depth and round-trips', () => {
    const p = toXYZ(142.5, 27.2, 680);
    expect(Math.hypot(...p)).toBeCloseTo(1 - 680 / 6371, 6);
    const b = fromXYZ(...p);
    expect(b.lon).toBeCloseTo(142.5); expect(b.lat).toBeCloseTo(27.2); expect(b.depthKm).toBeCloseTo(680, 3);
  });
});

describe('quakes', () => {
  it('decodes the 10-byte records written by build_quakes.mjs', () => {
    const buf = new ArrayBuffer(20), v = new DataView(buf);
    v.setInt16(0, -17550, true); v.setInt16(2, 5200, true); v.setUint16(4, 6800, true); v.setUint8(6, 73); v.setUint8(7, 115);
    v.setInt16(10, 100, true); v.setInt16(12, -100, true); v.setUint16(14, 100, true); v.setUint8(16, 50); v.setUint8(17, 73);
    const q = decodeQuakes(buf);
    expect(q.n).toBe(2);
    expect(q.lon[0]).toBeCloseTo(-175.5); expect(q.lat[0]).toBeCloseTo(52); expect(q.depth[0]).toBeCloseTo(680); expect(q.mag[0]).toBeCloseTo(7.3); expect(q.year[0]).toBe(2015);
  });
  it('bands depths', () => {
    expect(quakeBand(10)).toBe(0); expect(quakeBand(150)).toBe(1); expect(quakeBand(650)).toBe(2);
  });
});

// rows as built from the Atlas table (Aegean and Algeria, 2019 update)
const aegean: Slab = { name: 'Aegean', abbr: 'Aeg', mid: [27, 41, 700], surface: [24, 35.5], top: [0, 0], base: [1400, 100], ageBase: [100, 120], ageTop: [0, 0], rate: [12.73, 27.8] };
const algeria: Slab = { name: 'Algeria', abbr: 'Ag', mid: [7, 24, 1900], surface: [20, 41], top: [1400, 100], base: [2400, 200], ageBase: [170, 180], ageTop: [120, 140], rate: [13.71, 10.77] };

describe('slab stories', () => {
  it('tells active and finished slabs apart', () => {
    expect(isActive(aegean)).toBe(true); expect(isActive(algeria)).toBe(false);
    expect(sinkingStory(aegean)).toBe('It has been going down since about 120 million years ago, and still is.');
    expect(sinkingStory(algeria)).toBe('It went down between about 180 and 120 million years ago.');
  });
  it('knows when a slab was going down', () => {
    expect(sinkingAt(algeria, 150)).toBe(true); expect(sinkingAt(algeria, 100)).toBe(false); expect(sinkingAt(aegean, 0)).toBe(true);
  });
  it('compares sinking rates with fingernails', () => {
    expect(rateWords(12.73)).toBe('1.3 cm a year, about a third of the speed fingernails grow');
    expect(rateWords(42)).toBe('4.2 cm a year, about as fast as fingernails grow');
    expect(rateWords(2)).toBe('0.2 cm a year, about a tenth of the speed fingernails grow');
    expect(rateWords(null)).toBeNull(); expect(rateWords(0)).toBeNull();
  });
});
