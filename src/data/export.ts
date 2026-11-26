// Exporters: CSV, GeoJSON, BibTeX/RIS/APA citations, file download, SVG -> PNG at a chosen DPI.

import type { Slab } from '../science/slabs';
import { interval, isActive, regime } from '../science/slabs';

const csvCell = (v: unknown) => {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export const SLAB_COLUMNS = ['nr', 'name', 'abbr', 'status', 'regime', 'mid_lon', 'mid_lat', 'mid_depth_km', 'top_km', 'top_err_km', 'base_km', 'base_err_km',
  'onset_young_ma', 'onset_old_ma', 'end_young_ma', 'end_old_ma', 'rate_base_mm_yr', 'rate_base_err', 'rate_top_mm_yr', 'rate_top_err', 'surface_lon', 'surface_lat', 'slab2_zone', 'updated', 'note'];
export function slabRow(s: Slab, slab2?: string): unknown[] {
  return [s.nr, s.name, s.abbr, isActive(s) ? 'active' : 'detached', regime(s), s.mid[0], s.mid[1], s.mid[2], s.top[0], s.top[1], s.base[0], s.base[1],
    s.ageBase?.[0], s.ageBase?.[1], s.ageTop?.[0], s.ageTop?.[1], s.rateBase?.[0], s.rateBase?.[1], s.rateTop?.[0], s.rateTop?.[1],
    s.surface?.[0], s.surface?.[1], slab2 ?? '', s.updated, [s.ageNote, s.topRateNote].filter(Boolean).join('; ')];
}

export function slabsGeoJson(slabs: Slab[], slab2: (abbr: string) => string | undefined) {
  return {
    type: 'FeatureCollection',
    features: slabs.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.mid[0], s.mid[1]] },
      properties: Object.fromEntries(SLAB_COLUMNS.map((c, i) => [c, slabRow(s, slab2(s.abbr))[i] ?? null]).concat([['subduction_interval_ma', interval(s)]])),
    })),
  };
}

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Rasterise an SVG element to PNG at dpi (the SVG's CSS pixels are taken as 96 dpi). */
export async function svgToPng(svg: SVGSVGElement, dpi = 300): Promise<Blob> {
  const w = svg.viewBox.baseVal.width || svg.clientWidth, h = svg.viewBox.baseVal.height || svg.clientHeight, k = dpi / 96;
  const src = new XMLSerializer().serializeToString(inlineStyles(svg));
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
  await img.decode();
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(w * k), height: Math.round(h * k) });
  const g = c.getContext('2d')!;
  g.fillStyle = getComputedStyle(svg).getPropertyValue('--chart-bg') || '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
}

/** Copy of an SVG with computed colours and fonts written inline, so it renders the same outside the page. */
export function inlineStyles(svg: SVGSVGElement): SVGSVGElement {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const src = svg.querySelectorAll('*'), dst = copy.querySelectorAll('*');
  const props = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline'];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el), d = dst[i] as SVGElement;
    d.setAttribute('style', props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const bg = getComputedStyle(svg).getPropertyValue('--chart-bg').trim();
  if (bg) copy.style.background = bg;
  return copy;
}

export interface Ref { key: string; type: 'article' | 'misc'; author: string; title: string; year: number; journal?: string; volume?: string; pages?: string; doi?: string; url?: string; publisher?: string; note?: string; apa: string }
export const REFS: Ref[] = [
  { key: 'vanderMeer2018', type: 'article', author: 'van der Meer, Douwe G. and van Hinsbergen, Douwe J. J. and Spakman, Wim', title: 'Atlas of the underworld: Slab remnants in the mantle, their sinking history, and a new outlook on lower mantle viscosity', year: 2018, journal: 'Tectonophysics', volume: '723', pages: '309--448', doi: '10.1016/j.tecto.2017.10.004', note: 'CC BY 4.0; catalogue table updated 2019 at atlas-of-the-underworld.org',
    apa: 'van der Meer, D. G., van Hinsbergen, D. J. J., & Spakman, W. (2018). Atlas of the underworld: Slab remnants in the mantle, their sinking history, and a new outlook on lower mantle viscosity. Tectonophysics, 723, 309–448. https://doi.org/10.1016/j.tecto.2017.10.004' },
  { key: 'Hayes2018', type: 'misc', author: 'Hayes, Gavin', title: 'Slab2 - A Comprehensive Subduction Zone Geometry Model', year: 2018, publisher: 'U.S. Geological Survey data release', doi: '10.5066/F7PV6JNV',
    apa: 'Hayes, G. (2018). Slab2 - A comprehensive subduction zone geometry model [Data set]. U.S. Geological Survey. https://doi.org/10.5066/F7PV6JNV' },
  { key: 'USGSComCat', type: 'misc', author: '{U.S. Geological Survey}', title: 'Advanced National Seismic System (ANSS) Comprehensive Catalog of Earthquake Events and Products (ComCat)', year: 2017, publisher: 'U.S. Geological Survey', doi: '10.5066/F7MS3QZH', url: 'https://earthquake.usgs.gov/fdsnws/event/1/',
    apa: 'U.S. Geological Survey, Earthquake Hazards Program. (2017). Advanced National Seismic System (ANSS) Comprehensive Catalog of Earthquake Events and Products [Data set]. https://doi.org/10.5066/F7MS3QZH' },
  { key: 'Bird2003', type: 'article', author: 'Bird, Peter', title: 'An updated digital model of plate boundaries', year: 2003, journal: 'Geochemistry, Geophysics, Geosystems', volume: '4', pages: '1027', doi: '10.1029/2001GC000252', note: 'GeoJSON by H. Ahlenius, github.com/fraxen/tectonicplates, ODC-BY 1.0',
    apa: 'Bird, P. (2003). An updated digital model of plate boundaries. Geochemistry, Geophysics, Geosystems, 4(3), 1027. https://doi.org/10.1029/2001GC000252' },
  { key: 'Dziewonski1981', type: 'article', author: 'Dziewonski, Adam M. and Anderson, Don L.', title: 'Preliminary reference Earth model', year: 1981, journal: 'Physics of the Earth and Planetary Interiors', volume: '25', pages: '297--356', doi: '10.1016/0031-9201(81)90046-7',
    apa: 'Dziewonski, A. M., & Anderson, D. L. (1981). Preliminary reference Earth model. Physics of the Earth and Planetary Interiors, 25(4), 297–356. https://doi.org/10.1016/0031-9201(81)90046-7' },
];

export function bibtex(refs = REFS): string {
  return refs.map((r) => {
    const f: [string, string | number | undefined][] = [['author', r.author], ['title', `{${r.title}}`], ['year', r.year], ['journal', r.journal], ['volume', r.volume], ['pages', r.pages], ['publisher', r.publisher], ['doi', r.doi], ['url', r.url], ['note', r.note]];
    return `@${r.type}{${r.key},\n` + f.filter(([, v]) => v != null).map(([k, v]) => `  ${k} = {${v}}`).join(',\n') + '\n}';
  }).join('\n\n') + '\n';
}
export function ris(refs = REFS): string {
  return refs.map((r) => [`TY  - ${r.type === 'article' ? 'JOUR' : 'DATA'}`, ...r.author.split(' and ').map((a) => `AU  - ${a.replace(/[{}]/g, '')}`), `TI  - ${r.title}`, `PY  - ${r.year}`,
    r.journal && `JO  - ${r.journal}`, r.volume && `VL  - ${r.volume}`, r.pages && `SP  - ${r.pages.split('--')[0]}`, r.pages?.includes('--') && `EP  - ${r.pages.split('--')[1]}`, r.doi && `DO  - ${r.doi}`, r.url && `UR  - ${r.url}`, 'ER  - '].filter(Boolean).join('\n')).join('\n\n') + '\n';
}
export const apa = (refs = REFS) => refs.map((r) => r.apa).join('\n\n') + '\n';
