// The analysis charts. Each returns an SVG element sized W x H; data in, picture out, callbacks for linked selection.

import { BOUNDARY_COLORS, SLAB_STATUS, css, PLASMA, QUAKE_DEPTH_MAX, VIRIDIS, SLAB2_DEPTH_MAX } from '../core/colormap';
import { fmt } from '../core/format';
import { BOUNDARIES, prem } from '../science/prem';
import { magnitudeDiameterPx, bValue, cumulativeFmd, momentSum } from '../science/seismology';
import { histogram } from '../science/stats';
import { isActive, sinkingAnalysis, type DepthAgePoint, type Slab } from '../science/slabs';
import { axes, clip, frame, linear, log10, s } from './svg';

// ---------- cross-section ----------
export interface SectionData {
  halfLengthKm: number; halfWidthKm: number; az: number; ve: number;
  quakes: { i: number; x: number; depth: number; mag: number; off: number }[];
  slab2: { x: number; depth: number; thk: number; unc: number; dip: number }[];
  slabs: { slab: Slab; x: number; off: number }[];
  trenches: { x: number; cls: string; vel: number; div: number }[];
  aLabel: string; bLabel: string;
}
export function sectionChart(d: SectionData, W: number, H: number, sel: { slab?: string | null; quake?: number }, on: { slab: (s: Slab) => void; quake: (i: number) => void }): SVGSVGElement {
  const f = frame(W, H, { l: 60, r: 18, t: 22, b: 40 }, 'Cross-section');
  const pw = W - f.m.l - f.m.r, ph = H - f.m.t - f.m.b;
  const x = linear([-d.halfLengthKm, d.halfLengthKm], [f.m.l, W - f.m.r]);
  // vertical exaggeration: km per pixel vertically = horizontal km per pixel / ve
  const kmPerPx = (2 * d.halfLengthKm) / pw, depthMax = Math.min(6371, (ph * kmPerPx) / d.ve);
  const y = linear([0, depthMax], [f.m.t, H - f.m.b]);
  axes(f, x, y, `Distance along profile (km), azimuth ${fmt(d.az, 0)}° · swath ±${fmt(d.halfWidthKm)} km · V.E. ${d.ve}:1`, 'Depth (km)');
  clip(f, 'clip-sec');
  const g = f.plot;
  for (const b of BOUNDARIES) {
    if (b.depth > depthMax || b.depth < 100) continue;
    g.append(s('line', { x1: f.m.l, x2: W - f.m.r, y1: y(b.depth), y2: y(b.depth), class: b.depth === 660 || b.depth === 2891 ? 'ref strong' : 'ref' }),
      s('text', { x: W - f.m.r - 4, y: y(b.depth) - 3, 'text-anchor': 'end', class: 'reflabel' }, b.name));
  }
  // Slab2: slab body down to the vertical thickness thk / cos(dip) (exact for a locally planar slab), then the top's ±1σ
  for (const p of d.slab2) if (p.dip < 80) g.append(s('line', { x1: x(p.x), x2: x(p.x), y1: y(p.depth), y2: y(p.depth + p.thk / Math.cos((p.dip * Math.PI) / 180)), class: 'slab2body' }));
  for (const p of d.slab2) g.append(s('line', { x1: x(p.x), x2: x(p.x), y1: y(p.depth - p.unc), y2: y(p.depth + p.unc), class: 'slab2unc' }));
  for (const p of d.slab2) g.append(s('circle', { cx: x(p.x), cy: y(p.depth), r: 1.3, class: 'slab2pt', fill: css(VIRIDIS, p.depth / SLAB2_DEPTH_MAX) }));
  for (const t of d.trenches) {
    const c = BOUNDARY_COLORS[t.cls] ?? '#999';
    const tri = s('path', { d: `M${x(t.x)},${f.m.t + 1} l-5,-9 h10 z`, fill: c, class: 'trench' });
    tri.append(s('title', {}, `PB2002 ${t.cls} · relative velocity ${fmt(t.vel, 1)} mm/yr · ${t.div < 0 ? 'convergence' : 'divergence'} ${fmt(Math.abs(t.div), 1)} mm/yr`));
    g.append(tri);
  }
  for (const q of d.quakes) {
    const c = s('circle', { cx: x(q.x), cy: y(q.depth), r: magnitudeDiameterPx(q.mag) / 2, fill: css(PLASMA, q.depth / QUAKE_DEPTH_MAX), class: 'eq' + (sel.quake === q.i ? ' sel' : '') });
    c.addEventListener('click', () => on.quake(q.i));
    g.append(c);
  }
  for (const it of d.slabs) {
    const sl = it.slab, color = isActive(sl) ? SLAB_STATUS.active : SLAB_STATUS.detached, cx = x(it.x);
    const grp = s('g', { class: 'atlas' + (sel.slab === sl.abbr ? ' sel' : '') });
    grp.append(s('line', { x1: cx, x2: cx, y1: y(Math.max(0, sl.top[0] - sl.top[1])), y2: y(sl.base[0] + sl.base[1]), stroke: color, class: 'err' }),
      s('rect', { x: cx - 5, y: y(sl.top[0]), width: 10, height: Math.max(1, y(sl.base[0]) - y(sl.top[0])), fill: color, class: 'body' }),
      s('line', { x1: cx - 8, x2: cx + 8, y1: y(sl.mid[2]), y2: y(sl.mid[2]), stroke: color, class: 'mid' }),
      s('text', { x: cx + 9, y: y(sl.mid[2]) + 4, class: 'atlaslabel' }, sl.abbr));
    grp.append(s('title', {}, `${sl.name}: top ${fmt(sl.top[0])} ± ${fmt(sl.top[1])} km, base ${fmt(sl.base[0])} ± ${fmt(sl.base[1])} km; ${fmt(Math.abs(it.off))} km off the section plane (projected)`));
    grp.addEventListener('click', () => on.slab(sl));
    g.append(grp);
  }
  f.svg.append(s('text', { x: f.m.l + 2, y: 14, class: 'endlabel' }, `A ${d.aLabel}`), s('text', { x: W - f.m.r - 2, y: 14, 'text-anchor': 'end', class: 'endlabel' }, `A′ ${d.bLabel}`));
  return f.svg;
}

// ---------- depth vs age ----------
export function depthAgeChart(points: DepthAgePoint[], W: number, H: number, highlight: Set<string>, onPick: (abbr: string) => void): SVGSVGElement {
  const f = frame(W, H, { l: 60, r: 232, t: 14, b: 40 }, 'Slab depth versus subduction age');
  const x = linear([0, 300], [f.m.l, W - f.m.r]), y = linear([0, 3000], [f.m.t, H - f.m.b]);
  axes(f, x, y, 'Age of subduction (Ma)', 'Depth (km)');
  clip(f, 'clip-da');
  const g = f.plot, a = sinkingAnalysis(points);
  g.append(s('line', { x1: x(0), x2: x(300), y1: y(660), y2: y(660), class: 'ref strong' }), s('text', { x: x(300) - 4, y: y(660) - 4, 'text-anchor': 'end', class: 'reflabel' }, '660 km'));
  const line = (slope: number, cls: string, z0: number, z1: number) => g.append(s('line', { x1: x(z0 / slope), y1: y(z0), x2: x(Math.min(300, z1 / slope)), y2: y(Math.min(z1, 300 * slope)), class: cls }));
  if (a.lower) line(a.lower.slope, 'fit', 660, 3000);
  if (a.upper) line(a.upper.slope, 'fit dashed', 0, 660);
  if (a.lowerFree) { const lf = a.lowerFree; g.append(s('line', { x1: x((660 - lf.intercept) / lf.slope), y1: y(660), x2: x(Math.min(300, (3000 - lf.intercept) / lf.slope)), y2: y(Math.min(3000, lf.intercept + 300 * lf.slope)), class: 'fit dotted' })); }
  for (const p of points) {
    const hl = highlight.has(p.abbr);
    const grp = s('g', { class: 'pt' + (hl ? ' hl' : '') });
    grp.append(s('line', { x1: x(p.ageLo), x2: x(p.ageHi), y1: y(p.depth), y2: y(p.depth), class: 'err' }), s('line', { x1: x(p.age), x2: x(p.age), y1: y(p.depth - p.depthErr), y2: y(p.depth + p.depthErr), class: 'err' }),
      s(p.part === 'base' ? 'circle' : 'rect', p.part === 'base' ? { cx: x(p.age), cy: y(p.depth), r: hl ? 5 : 3.2 } : { x: x(p.age) - 3, y: y(p.depth) - 3, width: 6, height: 6 }));
    grp.append(s('title', {}, `${p.abbr} ${p.part}: ${fmt(p.depth)} ± ${fmt(p.depthErr)} km, ${fmt(p.ageLo, 1)}–${fmt(p.ageHi, 1)} Ma`));
    grp.addEventListener('click', () => onPick(p.abbr));
    g.append(grp);
  }
  const lx = W - f.m.r + 10;
  const leg = s('g', { class: 'legend' });
  const lines = [
    '● base (onset)  ■ top (end)',
    a.lower ? `> 660 km: v = ${fmt(a.lower.slope, 1)} mm/yr` : '',
    a.lower ? `  95% CI ${fmt(a.lower.slopeCI95[0], 1)}–${fmt(a.lower.slopeCI95[1], 1)}, n = ${a.lower.n}` : '',
    a.lower ? `  R² = ${fmt(a.lower.r2, 2)} (through origin)` : '',
    a.lowerFree ? `free fit: ${fmt(a.lowerFree.slope, 1)} mm/yr + ${fmt(a.lowerFree.intercept)} km` : '',
    a.upper ? `≤ 660 km: v = ${fmt(a.upper.slope, 1)} mm/yr` : '',
    a.upper ? `  95% CI ${fmt(a.upper.slopeCI95[0], 1)}–${fmt(a.upper.slopeCI95[1], 1)}, n = ${a.upper.n}` : '',
    `mean of depth/age > 660 km:`, `  ${fmt(a.lowerRates.mean, 1)} ± ${fmt(a.lowerRates.sd, 1)} mm/yr (1σ)`,
  ].filter(Boolean);
  lines.forEach((t, i) => leg.append(s('text', { x: lx, y: f.m.t + 12 + i * 15, class: 'tl' }, t)));
  f.svg.append(leg);
  return f.svg;
}

// ---------- sinking rates ----------
export function ratesChart(slabs: Slab[], W: number, H: number, highlight: Set<string>, onPick: (abbr: string) => void): SVGSVGElement {
  const f = frame(W, H, { l: 60, r: 16, t: 14, b: 40 }, 'Sinking rate versus depth');
  const x = log10([3, 150], [f.m.l, W - f.m.r]), y = linear([0, 3000], [f.m.t, H - f.m.b]);
  axes(f, x, y, 'Average sinking rate (mm/yr, log scale): ● base (depth ÷ onset age), ○ top (depth ÷ end age)', 'Depth of that part (km)', { xTicks: [3, 5, 10, 20, 50, 100] });
  clip(f, 'clip-rt');
  const g = f.plot;
  g.append(s('line', { x1: f.m.l, x2: W - f.m.r, y1: y(660), y2: y(660), class: 'ref strong' }));
  for (const sl of slabs) {
    const hl = highlight.has(sl.abbr);
    for (const [r, z, open] of [[sl.rateBase, sl.base[0], false], [sl.top[0] > 0 ? sl.rateTop : null, sl.top[0], true]] as const) {
      if (!r) continue;
      const grp = s('g', { class: 'pt' + (hl ? ' hl' : '') + (open ? ' open' : '') });
      grp.append(s('line', { x1: x(Math.max(3, r[0] - r[1])), x2: x(Math.min(150, r[0] + r[1])), y1: y(z), y2: y(z), class: 'err' }), s('circle', { cx: x(Math.min(150, Math.max(3, r[0]))), cy: y(z), r: hl ? 5 : 3.2 }));
      grp.append(s('title', {}, `${sl.name} ${open ? 'top' : 'base'}: ${fmt(r[0], 1)} ± ${fmt(r[1], 1)} mm/yr at ${fmt(z)} km`));
      grp.addEventListener('click', () => onPick(sl.abbr));
      g.append(grp);
    }
  }
  return f.svg;
}

// ---------- seismicity: depth histogram + Gutenberg-Richter ----------
export function seismicityChart(depths: number[], mags: number[], types: string[], W: number, H: number, scope: string, relation?: string): SVGSVGElement {
  const f = frame(W, H, { l: 60, r: 16, t: 26, b: 40 }, 'Seismicity');
  const half = Math.floor((W - 30) / 2);
  const hist = histogram(depths, 0, 700, 25), maxC = Math.max(1, ...hist.counts);
  const x1 = log10([0.8, maxC * 1.5], [f.m.l, half - 10]), y1 = linear([0, 700], [f.m.t, H - f.m.b]);
  const f1 = { ...f, W: half, m: { ...f.m, r: 10 } };
  axes(f1, x1, y1, 'Events per 25 km (log)', 'Depth (km)');
  hist.counts.forEach((c, i) => { if (c) f.plot.append(s('rect', { x: f.m.l, y: y1(hist.edges[i]), width: x1(c) - f.m.l, height: y1(hist.edges[i + 1]) - y1(hist.edges[i]) - 0.5, class: 'bar', fill: css(PLASMA, (hist.edges[i] + 12.5) / QUAKE_DEPTH_MAX) })); });
  f.plot.append(s('line', { x1: f.m.l, x2: half - 10, y1: y1(660), y2: y1(660), class: 'ref strong' }));

  const fmd = cumulativeFmd(mags), bv = bValue(mags, 0.1, 50, 5);
  const x2 = linear([5, Math.max(8, Math.ceil(Math.max(5, ...mags) + 0.2))], [half + 60, W - f.m.r]), y2 = log10([0.8, Math.max(10, mags.length * 1.5)], [H - f.m.b, f.m.t]);
  const f2 = { ...f, m: { ...f.m, l: half + 60 } };
  axes(f2, x2, y2, 'Magnitude', 'N (≥ M)', { fmtX: (v) => v.toFixed(1) });
  fmd.m.forEach((m, i) => f.plot.append(s('circle', { cx: x2(m), cy: y2(fmd.n[i]), r: 2.6, class: 'gr' })));
  if (bv) f.plot.append(s('line', { x1: x2(bv.mc), y1: y2(10 ** (bv.a - bv.b * bv.mc)), x2: x2(x2.domain[1]), y2: y2(Math.max(0.8, 10 ** (bv.a - bv.b * x2.domain[1]))), class: 'fit' }));
  const ms = momentSum(mags, types);
  const txt = [
    `${scope}: ${fmt(mags.length)} events M≥5`,
    bv ? `b = ${fmt(bv.b, 2)} ± ${fmt(bv.sigma, 2)} (Mc ${bv.mc.toFixed(1)}, n = ${fmt(bv.n)}, Aki–Utsu MLE)` : 'b-value: fewer than 50 events',
    mags.length ? `ΣM₀ = ${ms.sumM0.toExponential(2)} N·m ≡ Mw ${fmt(ms.mwEquivalent, 2)} · ${fmt(ms.fractionMw * 100)}% Mw-type` : '',
  ];
  // header line over each panel; moment sum under the histogram title
  f.svg.append(s('text', { x: f.m.l, y: 11, class: 'tl head' }, txt[0]), s('text', { x: half + 60, y: 11, class: 'tl head' }, txt[1]), s('text', { x: f.m.l, y: 23, class: 'tl' }, txt[2]));
  if (relation) f.svg.append(s('text', { x: half + 60, y: 23, class: 'tl' }, relation));
  return f.svg;
}

// ---------- PREM profile ----------
export function premChart(W: number, H: number, markDepth: number | null): SVGSVGElement {
  const f = frame(W, H, { l: 60, r: 110, t: 14, b: 40 }, 'PREM');
  const x = linear([0, 14], [f.m.l, W - f.m.r]), y = linear([0, 6371], [f.m.t, H - f.m.b]);
  axes(f, x, y, 'Vp, Vs (km/s) · ρ (g/cm³) · P/30 (GPa) · g (m/s²)', 'Depth (km)');
  const series: [string, (d: number) => number, string][] = [['Vp', (d) => prem(d).vp, 'c1'], ['Vs', (d) => prem(d).vs, 'c2'], ['ρ', (d) => prem(d).rho, 'c3'], ['P / 30', (d) => prem(d).pGPa / 30, 'c4'], ['g', (d) => prem(d).gMs2, 'c5']];
  series.forEach(([name, fn, cls], k) => {
    let dPath = '';
    for (let dep = 0; dep <= 6371; dep += 5) dPath += `${dep ? 'L' : 'M'}${x(fn(dep)).toFixed(1)},${y(dep).toFixed(1)}`;
    f.plot.append(s('path', { d: dPath, class: `series ${cls}` }));
    f.svg.append(s('text', { x: W - f.m.r + 10, y: f.m.t + 14 + k * 16, class: `tl ${cls}t` }, `— ${name}`));
  });
  for (const b of BOUNDARIES) if (b.depth >= 400) f.plot.append(s('line', { x1: f.m.l, x2: W - f.m.r, y1: y(b.depth), y2: y(b.depth), class: 'ref' }));
  if (markDepth != null) {
    const p = prem(markDepth);
    f.plot.append(s('line', { x1: f.m.l, x2: W - f.m.r, y1: y(markDepth), y2: y(markDepth), class: 'mark' }));
    [`${fmt(markDepth)} km`, `P ${fmt(p.pGPa, 1)} GPa`, `ρ ${fmt(p.rho, 2)}`, `Vp ${fmt(p.vp, 2)}`, `Vs ${fmt(p.vs, 2)}`, `g ${fmt(p.gMs2, 2)}`].forEach((t, i) => f.svg.append(s('text', { x: W - f.m.r + 10, y: f.m.t + 110 + i * 15, class: 'tl' }, t)));
  }
  return f.svg;
}
