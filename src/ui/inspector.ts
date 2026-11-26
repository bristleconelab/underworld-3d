// The right-hand inspector: a slab, an earthquake or a point of a Slab2 surface, as a table of measured values.

import { fmt, isoUtc, latlon, pm, range, sci } from '../core/format';
import { quakeIds } from '../data/load';
import { compass, toXYZ } from '../science/geodesy';
import { prem } from '../science/prem';
import { isMomentMagnitude, momentFromMw } from '../science/seismology';
import { depthAgePoints, interval, isActive, regime, sinkingAnalysis, surfaceOffset, rateZ, type Slab } from '../science/slabs';
import { $, el, type Ctx } from './dom';

const panel = () => $('#inspector'), body = () => $('#inspector .ins-body');

function table(rows: [string, string | Node][]) {
  const dl = el('dl', { class: 'facts' });
  for (const [k, v] of rows) dl.append(el('dt', {}, k), el('dd', {}, v));
  return dl;
}

export function openInspector(ctx: Ctx, title: string, kind: string, content: Node[]) {
  body().replaceChildren(el('p', { class: 'kind' }, kind), el('h2', {}, title), ...content);
  panel().hidden = false;
  body().scrollTop = 0;
  ctx.globe.invalidate();
  window.dispatchEvent(new Event('docks'));
}
export function closeInspector() { panel().hidden = true; window.dispatchEvent(new Event('docks')); }

let lowerPop: { mean: number; sd: number } | null = null;

export function slabCard(ctx: Ctx, s: Slab) {
  const { data, store, globe } = ctx;
  lowerPop ??= sinkingAnalysis(depthAgePoints(data.slabs)).lowerRates;
  const active = isActive(s), xr = data.crossref[s.abbr], iv = interval(s), off = surfaceOffset(s), p = prem(s.mid[2]);
  const z = s.base[0] > 660 ? rateZ(s, lowerPop) : null;
  const checks = data.rateCheck.filter((c) => c.abbr === s.abbr);
  const rows: [string, string][] = [
    ['Catalogue', `#${s.nr} · ${s.abbr}${s.updated ? ` · updated ${s.updated}` : ''}`],
    ['Status', active ? 'Active subduction (top at surface, 0 Ma)' : 'Detached slab remnant'],
    ['Depth regime', regime(s)],
    ['Midpoint', `${latlon(s.mid[1], s.mid[0], 1)} · ${fmt(s.mid[2])} km`],
    ['Top', pm(s.top[0], s.top[1], 'km')],
    ['Base', pm(s.base[0], s.base[1], 'km')],
    ['Vertical extent', `${fmt(s.base[0] - s.top[0])} km`],
    ['Onset (base age)', range(s.ageBase, 'Ma')],
    ['End (top age)', active ? 'ongoing (0 Ma)' : range(s.ageTop, 'Ma')],
    ['Subduction interval', iv ? `${fmt(iv[1], 1)} → ${fmt(iv[0], 1)} Ma` : 'not estimated'],
    ['Base sinking rate', s.rateBase ? `${pm(s.rateBase[0], s.rateBase[1], 'mm/yr', 1)}${z != null ? ` · z = ${z >= 0 ? '+' : ''}${fmt(z, 2)} vs lower-mantle mean ${fmt(lowerPop.mean, 1)} ± ${fmt(lowerPop.sd, 1)}` : ''}` : 'not estimated'],
    ['Top sinking rate', s.rateTop ? pm(s.rateTop[0], s.rateTop[1], 'mm/yr', 1) + (s.topRateNote ? ' †' : '') : 'not estimated'],
    ['Geological record', s.surface ? latlon(s.surface[1], s.surface[0], 1) : 'not known'],
    ['Record → midpoint', off ? `${fmt(off.km)} km (${fmt(off.km / 111.195, 1)}°) toward ${fmt(off.az)}° (${compass(off.az)})` : '–'],
    ['Slab2 zone', xr ? `${xr.zone} · ${fmt(xr.distKm)} km away · down-dip ${xr.dipAz != null ? `${fmt(xr.dipAz)}°` : '–'} (R = ${fmt(xr.azConsistency, 2)})` : 'none within 400 km (or slab below 660 km)'],
    ['PREM at midpoint', `P ${fmt(p.pGPa, 1)} GPa · ρ ${fmt(p.rho, 2)} g/cm³ · Vp ${fmt(p.vp, 2)} · Vs ${fmt(p.vs, 2)} km/s`],
  ];
  const notes: string[] = [];
  if (s.topRateNote) notes.push(`† ${s.topRateNote}.`);
  if (s.ageNote) notes.push(`Ages ${s.ageNote}.`);
  for (const c of checks) notes.push(`Source check: ${c.field} in the table is ${c.table} mm/yr, depth ÷ mean age gives ${c.depthOverMeanAge} mm/yr; shown as tabulated.`);
  if (!s.ageBase) notes.push('The table gives no ages, surface record or rates for this slab (9999 = not estimated in the source).');
  const btn = (label: string, fn: () => void, cls = 'btn small ghost') => { const b = el('button', { class: cls }, label); b.addEventListener('click', fn); return b; };
  const inCmp = store.state.compare.includes(s.abbr);
  const actions = el('div', { class: 'btns' },
    btn('Cross-section', () => ctx.inspectSlab(s.abbr), 'btn small'),
    s.surface ? btn('Fly to geological record', () => globe.flyTowards(s.surface![0], s.surface![1], 2.2)) : null,
    btn('Depth–age plot', () => store.set({ dock: true, tab: 'depthage' })),
    btn(inCmp ? 'Remove from compare' : 'Add to compare', () => {
      const c = store.state.compare.filter((a) => a !== s.abbr);
      store.set({ compare: inCmp ? c : [...c, s.abbr].slice(-3) });
      slabCard(ctx, s);
    }),
  );
  openInspector(ctx, s.name, active ? 'Atlas slab · active subduction' : 'Atlas slab · detached remnant', [
    table(rows), ...notes.map((n) => el('p', { class: 'fine' }, n)), actions,
    el('p', { class: 'fine src' }, 'Source: van der Meer et al. (2018), Atlas of the Underworld, 2019 table (CC BY 4.0). Depth errors are the table\'s; ages are ranges, not 1σ.'),
  ]);
}

export async function quakeCard(ctx: Ctx, i: number) {
  const q = ctx.data.quakes, t = q.magTypes[q.magType[i]] ?? '?';
  const near = ctx.data.slabIndex?.nearest(toXYZ(q.lon[i], q.lat[i], q.depth[i]), 150);
  const p = prem(q.depth[i]);
  const sat = /^(mb|ms)/.test(t) ? ` (${t.startsWith('mb') ? 'mb saturates near 6–6.5' : 'Ms saturates near 8'})` : '';
  const rows: [string, string | Node][] = [
    ['Origin time', isoUtc(q.time[i])],
    ['Epicentre', latlon(q.lat[i], q.lon[i], 2) + (Number.isFinite(q.horErr[i]) ? ` ± ${fmt(q.horErr[i], 1)} km` : '')],
    ['Depth', Number.isFinite(q.depthErr[i]) ? pm(q.depth[i], q.depthErr[i], 'km', 1) : `${fmt(q.depth[i], 1)} km (error not reported)`],
    ['Magnitude', `${q.mag[i].toFixed(1)} ${t}${sat}`],
    ['Seismic moment', `${sci(momentFromMw(q.mag[i]))} N·m${isMomentMagnitude(t) ? '' : ' (from a non-Mw magnitude: indicative)'}`],
    ['Slab2', near ? `${near.zone}: ${near.distKm >= 0 ? '+' : ''}${fmt(near.distKm)} km from slab top (${near.distKm >= 0 ? 'above' : 'below'}), local dip ${fmt(near.dip)}°` : 'no Slab2 surface within 150 km'],
    ['PREM at depth', `P ${fmt(p.pGPa, 1)} GPa · Vp ${fmt(p.vp, 2)} · Vs ${fmt(p.vs, 2)} km/s`],
    ['USGS event', 'loading id…'],
  ];
  openInspector(ctx, `M ${q.mag[i].toFixed(1)} · ${fmt(q.depth[i])} km`, 'Earthquake · USGS ComCat', [table(rows), el('p', { class: 'fine src' }, 'Source: USGS ComCat (public domain). Hypocentre as catalogued; no relocation.')]);
  try {
    const ids = await quakeIds(), id = ids[i];
    const dd = body().querySelectorAll('dd');
    const a = el('a', { href: `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(id)}`, target: '_blank', rel: 'noopener' }, id);
    dd[dd.length - 1].replaceChildren(a);
  } catch { /* the id file is optional */ }
}

export function plateCard(ctx: Ctx, h: { zone: string; depthKm: number; dip: number; dipAz: number; lon: number; lat: number }) {
  const p = prem(h.depthKm);
  const linked = Object.entries(ctx.data.crossref).filter(([, x]) => x.zone === h.zone).map(([a]) => a);
  const rows: [string, string | Node][] = [
    ['Point', `${latlon(h.lat, h.lon, 2)} · ${fmt(h.depthKm)} km`],
    ['Dip', `${fmt(h.dip, 1)}°`],
    ['Down-dip azimuth', h.dipAz >= 0 ? `${fmt(h.dipAz)}° (${compass(h.dipAz)}); strike ${fmt((h.dipAz + 270) % 360)}°` : 'undefined (flat)'],
    ['PREM', `P ${fmt(p.pGPa, 1)} GPa · ρ ${fmt(p.rho, 2)} g/cm³ · Vp ${fmt(p.vp, 2)} km/s`],
  ];
  const links = el('p', { class: 'fine' }, linked.length ? 'Atlas slabs linked to this zone: ' : 'No Atlas slab linked to this zone.');
  for (const a of linked) { const b = el('button', { class: 'link' }, a); b.addEventListener('click', () => ctx.inspectSlab(a)); links.append(b, ' '); }
  openInspector(ctx, h.zone, 'Slab2 slab-top surface', [table(rows), links,
    el('p', { class: 'fine src' }, 'Source: Slab2 (Hayes 2018, public domain), thinned to 0.2°. Dip and azimuth from the depth gradient at the nearest node; Slab2 thickness and uncertainty grids are not loaded.')]);
}
