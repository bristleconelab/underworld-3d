// Minimal SVG plotting: linear/log scales, nice ticks, axes. Styling comes from CSS classes (styles.css, .chart).

export const NS = 'http://www.w3.org/2000/svg';
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text != null) e.textContent = text;
  return e;
}

export interface Scale { (v: number): number; domain: [number, number]; range: [number, number]; log?: boolean; invert(px: number): number }
export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain, [r0, r1] = range, k = (r1 - r0) / (d1 - d0 || 1);
  const f = ((v: number) => r0 + (v - d0) * k) as Scale;
  f.domain = domain; f.range = range; f.invert = (px) => d0 + (px - r0) / k;
  return f;
}
export function log10(domain: [number, number], range: [number, number]): Scale {
  const l = linear([Math.log10(domain[0]), Math.log10(domain[1])], range);
  const f = ((v: number) => l(Math.log10(v))) as Scale;
  f.domain = domain; f.range = range; f.log = true; f.invert = (px) => 10 ** l.invert(px);
  return f;
}

export function niceTicks(lo: number, hi: number, n = 6): number[] {
  const span = Math.abs(hi - lo); if (!(span > 0)) return [lo];
  const raw = span / n, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => span / x <= n) ?? 10 * mag;
  const a = Math.ceil(Math.min(lo, hi) / step) * step, out: number[] = [];
  for (let v = a; v <= Math.max(lo, hi) + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export interface Frame { svg: SVGSVGElement; plot: SVGGElement; W: number; H: number; m: { l: number; r: number; t: number; b: number } }
export function frame(W: number, H: number, m = { l: 58, r: 16, t: 14, b: 40 }, title?: string): Frame {
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart', role: 'img' });
  if (title) svg.append(s('title', {}, title));
  svg.append(s('rect', { x: 0, y: 0, width: W, height: H, class: 'bg' }));
  const plot = s('g');
  svg.append(plot);
  return { svg, plot, W, H, m };
}

export function axes(f: Frame, x: Scale, y: Scale, xLabel: string, yLabel: string, opts: { xTicks?: number[]; yTicks?: number[]; fmtX?: (v: number) => string; fmtY?: (v: number) => string; grid?: boolean } = {}) {
  const g = s('g', { class: 'axes' });
  const { l, r, t, b } = f.m, x0 = l, x1 = f.W - r, y0 = t, y1 = f.H - b;
  const xt = opts.xTicks ?? (x.log ? logTicks(x.domain) : niceTicks(x.domain[0], x.domain[1], Math.max(3, Math.round((x1 - x0) / 80))));
  const yt = opts.yTicks ?? (y.log ? logTicks(y.domain) : niceTicks(y.domain[0], y.domain[1], Math.max(3, Math.round((y1 - y0) / 45))));
  const fx = opts.fmtX ?? ((v: number) => v.toLocaleString('en-US')), fy = opts.fmtY ?? ((v: number) => v.toLocaleString('en-US'));
  for (const v of xt) {
    const px = x(v); if (px < x0 - 0.5 || px > x1 + 0.5) continue;
    if (opts.grid !== false) g.append(s('line', { x1: px, x2: px, y1: y0, y2: y1, class: 'grid' }));
    g.append(s('line', { x1: px, x2: px, y1: y1, y2: y1 + 4, class: 'tick' }), s('text', { x: px, y: y1 + 15, 'text-anchor': 'middle', class: 'tl' }, fx(v)));
  }
  for (const v of yt) {
    const py = y(v); if (py < y0 - 0.5 || py > y1 + 0.5) continue;
    if (opts.grid !== false) g.append(s('line', { x1: x0, x2: x1, y1: py, y2: py, class: 'grid' }));
    g.append(s('line', { x1: x0 - 4, x2: x0, y1: py, y2: py, class: 'tick' }), s('text', { x: x0 - 7, y: py + 3.5, 'text-anchor': 'end', class: 'tl' }, fy(v)));
  }
  g.append(s('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, class: 'box' }));
  g.append(s('text', { x: (x0 + x1) / 2, y: f.H - 6, 'text-anchor': 'middle', class: 'al' }, xLabel));
  const yl = Math.max(12, x0 - 46);
  g.append(s('text', { x: yl, y: (y0 + y1) / 2, 'text-anchor': 'middle', class: 'al', transform: `rotate(-90 ${yl} ${(y0 + y1) / 2})` }, yLabel));
  f.svg.insertBefore(g, f.plot);
  return g;
}

function logTicks(d: [number, number]): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(Math.min(...d))); e <= Math.ceil(Math.log10(Math.max(...d))); e++) out.push(10 ** e);
  return out;
}

/** Clip children of the plot group to the plot area. */
export function clip(f: Frame, id: string) {
  const cp = s('clipPath', { id }); cp.append(s('rect', { x: f.m.l, y: f.m.t, width: f.W - f.m.l - f.m.r, height: f.H - f.m.t - f.m.b }));
  f.svg.prepend(s('defs')); f.svg.querySelector('defs')!.append(cp);
  f.plot.setAttribute('clip-path', `url(#${id})`);
}
