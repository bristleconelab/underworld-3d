// The bottom analysis dock: cross-section, depth-age, sinking rates, seismicity, PREM. Also computes the section
// projection used by the CSV export.

import { latlon } from '../core/format';
import type { QuakeFilter, State } from '../core/store';
import { depthAgeChart, premChart, ratesChart, sectionChart, seismicityChart, type SectionData } from '../charts2d/charts';
import { download, svgToPng, toCsv, inlineStyles } from '../data/export';
import { endpoints, inSwath, project, projectLonLat, sectionFrame, type Section } from '../science/section';
import { toXYZ } from '../science/geodesy';
import { depthAgePoints } from '../science/slabs';
import { $, type Ctx } from './dom';

const passes = (f: QuakeFilter, m: number, d: number, y: number) => m >= f.magMin - 1e-3 && m <= f.magMax + 1e-3 && d >= f.depMin && d <= f.depMax && y >= f.yrMin && y < f.yrMax;

/** Everything inside the section swath, projected onto the section plane. */
export function sectionData(ctx: Ctx, sec: Section, ve: number): SectionData {
  const f = sectionFrame(sec), q = ctx.data.quakes, flt = ctx.store.state.quakes;
  const quakes: SectionData['quakes'] = [];
  for (let i = 0; i < q.n; i++) {
    if (!passes(flt, q.mag[i], q.depth[i], q.year[i])) continue;
    const p = projectLonLat(f, q.lon[i], q.lat[i], q.depth[i]);
    if (inSwath(f, p)) quakes.push({ i, x: p.xKm, depth: p.depthKm, mag: q.mag[i], off: p.offKm });
  }
  const slab2: SectionData['slab2'] = [];
  for (const m of ctx.data.plates) {
    for (let i = 0; i < m.depths.length; i++) {
      const p = project(f, [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]);
      if (inSwath(f, p)) slab2.push({ x: p.xKm, depth: p.depthKm });
    }
  }
  const slabs: SectionData['slabs'] = [];
  for (const s of ctx.data.slabs) {
    const p = projectLonLat(f, s.mid[0], s.mid[1], s.mid[2]);
    if (inSwath(f, p)) slabs.push({ slab: s, x: p.xKm, off: p.offKm });
  }
  const trenches: SectionData['trenches'] = [];
  const b = ctx.data.boundaries;
  if (b) for (let i = 0; i < b.n; i++) {
    const p0 = project(f, toXYZ(b.lon0[i], b.lat0[i])), p1 = project(f, toXYZ(b.lon1[i], b.lat1[i]));
    if (Math.sign(p0.offKm) === Math.sign(p1.offKm)) continue;
    const t = p0.offKm / (p0.offKm - p1.offKm), x = p0.xKm + (p1.xKm - p0.xKm) * t;
    if (Math.abs(x) <= sec.halfLengthKm && Math.abs(p0.xKm - p1.xKm) < 500) trenches.push({ x, cls: b.classes[b.cls[i]][0], vel: b.vel[i], div: b.div[i] });
  }
  const e = endpoints(sec);
  return { halfLengthKm: sec.halfLengthKm, halfWidthKm: sec.halfWidthKm, az: sec.az, ve, quakes, slab2, slabs, trenches, aLabel: latlon(e.a[1], e.a[0], 1), bLabel: latlon(e.b[1], e.b[0], 1) };
}

let lastCsv: { name: string; text: string } | null = null;

export function renderAnalysis(ctx: Ctx, s: State) {
  const dock = $('#analysis'), host = $('#chart');
  dock.hidden = !s.dock;
  $('#btn-analysis').setAttribute('aria-expanded', String(s.dock));
  document.querySelectorAll<HTMLButtonElement>('#analysis [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === s.tab)));
  window.dispatchEvent(new Event('docks'));
  if (!s.dock || !ctx.data.quakes) return;
  const W = Math.max(480, Math.floor(host.clientWidth || 900)), H = Math.max(240, Math.floor(host.clientHeight || 300));
  const hl = new Set([...(s.slab ? [s.slab] : []), ...s.compare]);
  const pick = (abbr: string) => ctx.inspectSlab(abbr);
  let svg: SVGSVGElement;
  lastCsv = null;
  if (s.tab === 'section') {
    if (!s.section) { host.replaceChildren(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'No section yet: select a slab, or use “Cut at view centre” in the left panel.' })); return; }
    const d = sectionData(ctx, s.section, s.ve);
    svg = sectionChart(d, W, H, { slab: s.slab, quake: ctx.sel.quake }, { slab: (sl) => ctx.inspectSlab(sl.abbr), quake: (i) => ctx.inspectQuake(i) });
    lastCsv = { name: 'underworld-section.csv', text: sectionCsv(ctx, s.section, d) };
  } else if (s.tab === 'depthage') {
    const pts = depthAgePoints(ctx.data.slabs);
    svg = depthAgeChart(pts, W, H, hl, pick);
    lastCsv = { name: 'underworld-depth-age.csv', text: `# ${ctx.data.slabSource}\n` + toCsv(['abbr', 'part', 'age_mean_ma', 'age_young_ma', 'age_old_ma', 'depth_km', 'depth_err_km'], pts.map((p) => [p.abbr, p.part, p.age, p.ageLo, p.ageHi, p.depth, p.depthErr])) };
  } else if (s.tab === 'rates') {
    svg = ratesChart(ctx.data.slabs, W, H, hl, pick);
  } else if (s.tab === 'seismicity') {
    const q = ctx.data.quakes, f = s.quakes, depths: number[] = [], mags: number[] = [], types: string[] = [];
    const fr = s.section ? sectionFrame(s.section) : null;
    for (let i = 0; i < q.n; i++) {
      if (!passes(f, q.mag[i], q.depth[i], q.year[i])) continue;
      if (fr && !inSwath(fr, projectLonLat(fr, q.lon[i], q.lat[i], q.depth[i]))) continue;
      depths.push(q.depth[i]); mags.push(q.mag[i]); types.push(q.magTypes[q.magType[i]]);
    }
    svg = seismicityChart(depths, mags, types, W, H, fr ? 'Section swath' : 'Global (filtered)');
  } else {
    const sl = s.slab ? ctx.data.byAbbr.get(s.slab) : null;
    svg = premChart(W, H, sl ? sl.mid[2] : null);
  }
  host.replaceChildren(svg);
}

function sectionCsv(ctx: Ctx, sec: Section, d: SectionData): string {
  const q = ctx.data.quakes, head = `# section centre ${sec.lat},${sec.lon} azimuth ${sec.az} half-length ${sec.halfLengthKm} km swath ±${sec.halfWidthKm} km; x = arc distance along profile at the surface\n# sources: USGS ComCat (public domain); Slab2 Hayes 2018 (public domain); ${ctx.data.slabSource}\n`;
  const rows: unknown[][] = [];
  for (const e of d.quakes) rows.push(['quake', e.i, e.x.toFixed(1), e.depth.toFixed(1), e.off.toFixed(1), e.mag, q.lon[e.i], q.lat[e.i], new Date(q.time[e.i] * 1000).toISOString()]);
  for (const s of d.slabs) rows.push(['atlas_slab', s.slab.abbr, s.x.toFixed(1), s.slab.mid[2], s.off.toFixed(1), '', s.slab.mid[0], s.slab.mid[1], '']);
  for (const p of d.slab2) rows.push(['slab2_node', '', p.x.toFixed(1), p.depth.toFixed(1), '', '', '', '', '']);
  return head + toCsv(['kind', 'id', 'x_km', 'depth_km', 'off_plane_km', 'mag', 'lon', 'lat', 'time_utc'], rows);
}

export function initAnalysis(ctx: Ctx) {
  document.querySelectorAll<HTMLButtonElement>('#analysis [data-tab]').forEach((b) => b.addEventListener('click', () => ctx.store.set({ tab: b.dataset.tab as State['tab'] })));
  $('#btn-analysis').addEventListener('click', () => ctx.store.set({ dock: !ctx.store.state.dock }));
  $('#analysis-close').addEventListener('click', () => ctx.store.set({ dock: false }));
  const svg = () => document.querySelector<SVGSVGElement>('#chart svg');
  $('#chart-svg').addEventListener('click', () => { const g = svg(); if (g) download(`underworld-${ctx.store.state.tab}.svg`, new XMLSerializer().serializeToString(inlineStyles(g)), 'image/svg+xml'); });
  $('#chart-png').addEventListener('click', async () => { const g = svg(); if (g) download(`underworld-${ctx.store.state.tab}-300dpi.png`, await svgToPng(g, 300), 'image/png'); });
  $('#chart-csv').addEventListener('click', () => (lastCsv ? download(lastCsv.name, lastCsv.text, 'text/csv') : ctx.toast('This chart has no CSV; use Export for the catalogue.')));
  let raf = 0, lastW = 0, lastH = 0;
  new ResizeObserver(([e]) => {
    const { width, height } = e.contentRect;
    if (Math.abs(width - lastW) < 2 && Math.abs(height - lastH) < 2) return;
    lastW = width; lastH = height;
    cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (ctx.store.state.dock) renderAnalysis(ctx, ctx.store.state as State); });
  }).observe($('#chart'));
}

export const currentSectionCsv = () => lastCsv?.name === 'underworld-section.csv' ? lastCsv : null;
export const forSection = (ctx: Ctx) => (ctx.store.state.section ? sectionData(ctx, ctx.store.state.section, ctx.store.state.ve) : null);
export { sectionCsv };
