// Number and unit formatting. Everything shown to the user goes through here so units stay consistent.

export const fmt = (n: number, digits = 0) => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '–');
export const km = (n: number) => `${fmt(n)} km`;
export const pm = (v: number, e: number, unit: string, digits = 0) => `${fmt(v, digits)} ± ${fmt(e, digits)} ${unit}`;
export const range = (r: [number, number] | null, unit: string, digits = 1) => (r ? (r[0] === r[1] ? `${fmt(r[0], digits)} ${unit}` : `${fmt(r[0], digits)}–${fmt(r[1], digits)} ${unit}`) : 'not estimated');
export const lat = (v: number, d = 2) => `${fmt(Math.abs(v), d)}° ${v >= 0 ? 'N' : 'S'}`;
export const lon = (v: number, d = 2) => `${fmt(Math.abs(v), d)}° ${v >= 0 ? 'E' : 'W'}`;
export const latlon = (la: number, lo: number, d = 2) => `${lat(la, d)}, ${lon(lo, d)}`;
export const sci = (x: number, d = 2) => { if (!Number.isFinite(x) || x === 0) return String(x); const e = Math.floor(Math.log10(Math.abs(x))); return `${(x / 10 ** e).toFixed(d)}×10${sup(e)}`; };
const SUP: Record<string, string> = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export const sup = (n: number) => String(n).split('').map((c) => SUP[c] ?? c).join('');
export const isoUtc = (sec: number) => new Date(sec * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
