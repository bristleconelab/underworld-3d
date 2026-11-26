import { describe, expect, it } from 'vitest';
import { DEFAULTS, fromHash, toHash } from '../src/core/store';
import { bearingDeg, descentPath, destination, fromXYZ, haversineKm, R_KM, slerp, toXYZ } from '../src/science/geodesy';
import { earthMassKg, phaseDeflectionKm, prem, premLocal } from '../src/science/prem';
import { endpoints, inSwath, projectLonLat, sectionFrame } from '../src/science/section';
import { bValue, magnitudeDiameterPx, momentFromMw, momentSum, mwFromMoment } from '../src/science/seismology';
import { depthsAt, interval, isActive, sinkingAnalysis, subductingAt, type Slab } from '../src/science/slabs';
import { ols, t95 } from '../src/science/stats';

describe('geodesy', () => {
  it('puts lon 0 / lat 0 on +z, lon 90 E on +x, north on +y, and round-trips', () => {
    expect(toXYZ(0, 0)).toEqual([0, 0, 1]);
    expect(toXYZ(90, 0)[0]).toBeCloseTo(1); expect(toXYZ(0, 90)[1]).toBeCloseTo(1);
    const b = fromXYZ(...toXYZ(142.5, 27.2, 680));
    expect(b.lon).toBeCloseTo(142.5); expect(b.lat).toBeCloseTo(27.2); expect(b.depthKm).toBeCloseTo(680, 3);
  });
  it('fromXYZ never returns NaN (centre, rounding beyond the pole)', () => {
    expect(fromXYZ(0, 0, 0)).toEqual({ lon: 0, lat: 0, depthKm: R_KM });
    const p = fromXYZ(0, 1 + 1e-12, 0);
    expect(p.lat).toBe(90); expect(Number.isNaN(p.lon)).toBe(false);
  });
  it('haversine, bearing and destination agree (London -> New York ~5,570 km)', () => {
    const d = haversineKm(-0.1278, 51.5074, -74.006, 40.7128);
    expect(d).toBeGreaterThan(5540); expect(d).toBeLessThan(5600);
    const az = bearingDeg(-0.1278, 51.5074, -74.006, 40.7128);
    const [lo, la] = destination(-0.1278, 51.5074, az, d);
    expect(lo).toBeCloseTo(-74.006, 3); expect(la).toBeCloseTo(40.7128, 3);
  });
  it('SLERP keeps unit length and even angular steps; descent path ends at the slab depth', () => {
    const a = toXYZ(0, 0), b = toXYZ(90, 0);
    const m = slerp(a, b, 0.5); expect(Math.hypot(...m)).toBeCloseTo(1); expect(fromXYZ(...m).lon).toBeCloseTo(45);
    expect(fromXYZ(...slerp(a, b, 0.25)).lon).toBeCloseTo(22.5);
    const p = descentPath(0, 0, 10, 0, 1000);
    expect(fromXYZ(...p[p.length - 1]).depthKm).toBeCloseTo(1000, 3);
    expect(fromXYZ(...p[24]).lon).toBeCloseTo(5, 3);
  });
});

describe('PREM (Dziewonski & Anderson 1981)', () => {
  it('reproduces published values', () => {
    expect(earthMassKg() / 5.972e24).toBeCloseTo(1, 2);
    const cmb = premLocal(2891); expect(cmb.rho).toBeCloseTo(5.566, 2); expect(cmb.vp).toBeCloseTo(13.717, 2); expect(cmb.vs).toBeCloseTo(7.265, 2);
    const core = premLocal(2891, true); expect(core.rho).toBeCloseTo(9.903, 2); expect(core.vs).toBe(0);
    const lm = premLocal(670, true); expect(lm.rho).toBeCloseTo(4.381, 2); expect(lm.vp).toBeCloseTo(10.751, 2);
    expect(prem(2891).pGPa).toBeCloseTo(135.8, 0);
    expect(prem(6371).pGPa).toBeGreaterThan(363); expect(prem(6371).pGPa).toBeLessThan(365);
    expect(prem(2891).gMs2).toBeCloseTo(10.68, 1);
    expect(prem(0).gMs2).toBeCloseTo(9.82, 1);
  });
  it('phase boundaries move the right way in a cold slab', () => {
    expect(phaseDeflectionKm(410, 3, -600)).toBeLessThan(0);   // 410 raised
    expect(phaseDeflectionKm(660, -2, -600)).toBeGreaterThan(0); // 660 depressed
    expect(Math.abs(phaseDeflectionKm(410, 3, -600))).toBeGreaterThan(40);
    expect(Math.abs(phaseDeflectionKm(410, 3, -600))).toBeLessThan(60);
  });
});

describe('cross-section', () => {
  it('a section along az 90 at the equator keeps equatorial points in the plane', () => {
    const f = sectionFrame({ lon: 0, lat: 0, az: 90, halfLengthKm: 2000, halfWidthKm: 100 });
    const p = projectLonLat(f, 10, 0, 500);
    expect(p.offKm).toBeCloseTo(0, 6);
    expect(p.xKm).toBeCloseTo(haversineKm(0, 0, 10, 0), 3);
    expect(p.depthKm).toBeCloseTo(500, 6);
    const q = projectLonLat(f, 0, 1, 0);
    expect(Math.abs(q.offKm)).toBeCloseTo(haversineKm(0, 0, 0, 1), 0);
    expect(inSwath(f, q)).toBe(false);
  });
  it('a down-dip profile across Tonga (az 281) is perpendicular to the N-S trench, unlike a meridian cut', () => {
    const tonga = sectionFrame({ lon: 178, lat: -20, az: 281, halfLengthKm: 1500, halfWidthKm: 150 });
    // two points 300 km apart along the N-S strike: off-plane distances differ a lot (they are spread across the swath)
    const a = projectLonLat(tonga, 178, -21.35, 300), b = projectLonLat(tonga, 178, -18.65, 300);
    expect(Math.abs(a.offKm - b.offKm)).toBeGreaterThan(250);
    // a point 500 km down-dip (west) projects 500 km along the profile
    const [lo, la] = destination(178, -20, 281, 500);
    const c = projectLonLat(tonga, lo, la, 400);
    expect(c.xKm).toBeCloseTo(500, -1); expect(Math.abs(c.offKm)).toBeLessThan(1);
    const e = endpoints(tonga.section);
    expect(haversineKm(e.a[0], e.a[1], e.b[0], e.b[1])).toBeCloseTo(3000, 0);
  });
});

describe('seismology', () => {
  it('moment and magnitude invert each other; summed moment is dominated by the largest event', () => {
    expect(mwFromMoment(momentFromMw(7.3))).toBeCloseTo(7.3, 10);
    expect(momentFromMw(6)).toBeCloseTo(1.2589e18, -15);
    const s = momentSum([9, 5, 5, 5]); expect(s.mwEquivalent).toBeCloseTo(9, 3);
  });
  it('recovers b = 1 from a synthetic Gutenberg-Richter sample', () => {
    // deterministic quantiles of an exponential with b = 1 above Mc = 5.0, binned to 0.1
    const mags: number[] = [], beta = Math.LN10;
    for (let i = 0; i < 4000; i++) mags.push(Math.round((4.95 - Math.log(1 - (i + 0.5) / 4000) / beta) * 10) / 10);
    const b = bValue(mags, 0.1, 50, 5)!;
    expect(b.b).toBeGreaterThan(0.93); expect(b.b).toBeLessThan(1.07);
    expect(b.sigma).toBeGreaterThan(0); expect(b.sigma).toBeLessThan(0.05);
  });
  it('symbol size grows with rupture size and is clamped', () => {
    expect(magnitudeDiameterPx(6)).toBeGreaterThan(magnitudeDiameterPx(5));
    expect(magnitudeDiameterPx(9.5)).toBeLessThanOrEqual(22); expect(magnitudeDiameterPx(4)).toBeGreaterThanOrEqual(1.5);
  });
});

describe('statistics', () => {
  it('OLS through the origin recovers a slope with a CI', () => {
    const x = [10, 20, 30, 40, 50], y = x.map((v, i) => 12 * v + (i % 2 ? 5 : -5));
    const f = ols(x, y, true)!;
    expect(f.slope).toBeCloseTo(12, 0); expect(f.slopeCI95[0]).toBeLessThan(12); expect(f.slopeCI95[1]).toBeGreaterThan(12);
    expect(t95(10)).toBeCloseTo(2.228, 3); expect(t95(1000)).toBeCloseTo(1.962, 2);
  });
});

const aegean: Slab = { nr: 1, name: 'Aegean', abbr: 'Aeg', updated: null, mid: [27, 41, 700], surface: [24, 35.5], top: [0, 0], base: [1400, 100], ageBase: [100, 120], ageTop: [0, 0], rateBase: [12.73, 1.47], rateTop: [27.8, 2.78] };
const algeria: Slab = { nr: 5, name: 'Algeria', abbr: 'Ag', updated: null, mid: [7, 24, 1900], surface: [20, 41], top: [1400, 100], base: [2400, 200], ageBase: [170, 180], ageTop: [120, 140], rateBase: [13.71, 1.21], rateTop: [10.77, 1.13] };
describe('slab kinematics', () => {
  it('interval, activity and back-advection', () => {
    expect(isActive(aegean)).toBe(true); expect(isActive(algeria)).toBe(false);
    expect(interval(algeria)).toEqual([120, 180]);
    expect(subductingAt(algeria, 150)).toBe(true); expect(subductingAt(algeria, 100)).toBe(false);
    // base reaches the surface at its mean onset age; top at its mean end age
    expect(depthsAt(algeria, 175 - 1e-6)!.base).toBeLessThan(5); // table rate 13.71 vs 2400/175 = 13.714
    expect(depthsAt(algeria, 176)).toBeNull();
    expect(depthsAt(algeria, 130)!.top).toBeCloseTo(0, 0);
    expect(depthsAt(aegean, 50)!.base).toBeCloseTo(1400 - 12.73 * 50, 6);
    expect(depthsAt(aegean, 50)!.top).toBe(0);
  });
  it('lower-mantle sinking rate from the real catalogue is about 12 mm/yr', async () => {
    const { readFileSync } = await import('node:fs');
    const { depthAgePoints } = await import('../src/science/slabs');
    const slabs = JSON.parse(readFileSync('public/data/slabs.json', 'utf8')).slabs as Slab[];
    const a = sinkingAnalysis(depthAgePoints(slabs));
    expect(a.lower!.slope).toBeGreaterThan(10); expect(a.lower!.slope).toBeLessThan(15);
    // van der Meer et al. (2018): ~12 mm/yr; the free-intercept fit is slower with a positive intercept (fast upper-mantle passage)
    expect(a.lowerFree!.slope).toBeLessThan(a.lower!.slope); expect(a.lowerFree!.intercept).toBeGreaterThan(0);
  });
});

describe('URL state', () => {
  it('round-trips the view state', () => {
    const s = { ...DEFAULTS, slab: 'TKH', section: { lon: 174, lat: -28, az: 281, halfLengthKm: 1800, halfWidthKm: 120 }, ve: 2, time: 150, timeMode: 'advect' as const, compare: ['In', 'Aeg'], quakes: { ...DEFAULTS.quakes, magMin: 6, depMin: 300 }, dock: true, tab: 'seismicity' as const };
    const { patch, camera } = fromHash(toHash(s, [1, 2, 3, 0, 0, 0]));
    expect(patch.slab).toBe('TKH'); expect(patch.section).toEqual(s.section); expect(patch.ve).toBe(2);
    expect(patch.time).toBe(150); expect(patch.timeMode).toBe('advect'); expect(patch.compare).toEqual(['In', 'Aeg']);
    expect(patch.quakes!.magMin).toBe(6); expect(patch.quakes!.depMin).toBe(300); expect(patch.tab).toBe('seismicity');
    expect(camera).toEqual([1, 2, 3, 0, 0, 0]);
  });
});
