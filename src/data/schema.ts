// Runtime validation of the data files. The same checks run in the tests (test/data.test.ts) and on page load, so a
// bad rebuild fails loudly instead of drawing a 9999-degree point.

import type { Slab } from '../science/slabs';
import type { Quakes } from './decode';

export const EARTH_AGE_MA = 4540;
export const CMB_KM = 2891;

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const range = (x: unknown, lo: number, hi: number) => isNum(x) && x >= lo && x <= hi;

/** Problems with one slab record; empty when valid. */
export function slabProblems(s: Slab): string[] {
  const p: string[] = [], id = s?.abbr ?? '?';
  const bad = (m: string) => p.push(`${id}: ${m}`);
  if (!s.name || !s.abbr) bad('name/abbr missing');
  if (!range(s.mid?.[0], -180, 180) || !range(s.mid?.[1], -90, 90)) bad(`midpoint ${s.mid}`);
  if (!range(s.mid?.[2], 0, CMB_KM)) bad(`mid depth ${s.mid?.[2]}`);
  if (s.surface && (!range(s.surface[0], -180, 180) || !range(s.surface[1], -90, 90))) bad(`surface ${s.surface}`);
  if (!range(s.top?.[0], 0, CMB_KM) || !range(s.base?.[0], 0, CMB_KM)) bad('top/base depth out of 0-2891 km');
  if (!(s.top[0] < s.base[0])) bad(`top ${s.top[0]} not above base ${s.base[0]}`);
  if (!(s.mid[2] >= s.top[0] && s.mid[2] <= s.base[0])) bad('mid depth outside top-base');
  if (!range(s.top[1], 0, 500) || !range(s.base[1], 0, 500)) bad('depth error out of 0-500 km');
  for (const [k, a] of [['ageBase', s.ageBase], ['ageTop', s.ageTop]] as const) {
    if (a == null) continue;
    if (!range(a[0], 0, EARTH_AGE_MA) || !range(a[1], 0, EARTH_AGE_MA)) bad(`${k} ${a} outside 0-${EARTH_AGE_MA} Ma`);
    if (!(a[0] <= a[1])) bad(`${k} not [young, old]: ${a}`);
  }
  if (s.ageBase && s.ageTop && !(s.ageTop[0] <= s.ageBase[1])) bad('subduction ends before it starts');
  for (const [k, r] of [['rateBase', s.rateBase], ['rateTop', s.rateTop]] as const) {
    if (r == null) continue;
    if (!range(r[0], 0.1, 300) || !range(r[1], 0, 300)) bad(`${k} ${r} outside 0.1-300 mm/yr`);
  }
  return p;
}

export function validateSlabs(slabs: Slab[]): string[] {
  const p = slabs.flatMap(slabProblems);
  if (new Set(slabs.map((s) => s.abbr)).size !== slabs.length) p.push('duplicate abbreviations');
  return p;
}

export function validateQuakes(q: Quakes): string[] {
  const p: string[] = [];
  for (let i = 0; i < q.n; i++) {
    if (!(Math.abs(q.lon[i]) <= 180 && Math.abs(q.lat[i]) <= 90)) p.push(`#${i} position`);
    if (!(q.depth[i] >= 0 && q.depth[i] < 800)) p.push(`#${i} depth ${q.depth[i]}`);
    if (!(q.mag[i] >= 5 && q.mag[i] <= 9.6)) p.push(`#${i} magnitude ${q.mag[i]}`);
    if (!(q.year[i] >= 1973 && q.year[i] < 2100)) p.push(`#${i} year ${q.year[i]}`);
    if (i && q.depth[i] < q.depth[i - 1]) p.push(`#${i} not sorted by depth`);
    if (q.magType[i] >= Math.max(1, q.magTypes.length)) p.push(`#${i} magType index`);
    if (p.length > 20) break;
  }
  return p;
}
