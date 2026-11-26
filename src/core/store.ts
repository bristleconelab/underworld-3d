// One typed state for the 3D view, the 2D panels, the table and the URL. Components read state, call set(), and
// subscribe to the keys they care about.

import type { Section } from '../science/section';

export type LayerKey = 'slabs' | 'slab2' | 'quakes' | 'boundaries' | 'shells' | 'graticule';
export type Tab = 'section' | 'depthage' | 'rates' | 'seismicity' | 'prem';
export interface QuakeFilter { magMin: number; magMax: number; yrMin: number; yrMax: number; depMin: number; depMax: number }

export interface State {
  slab: string | null;
  section: Section | null;
  autoAz: boolean;
  ve: number;
  slab2Color: 'depth' | 'thk' | 'unc';
  layers: Record<LayerKey, boolean>;
  surfaceOpacity: number;
  quakes: QuakeFilter;
  time: number;                       // Ma; 0 = present
  timeMode: 'filter' | 'advect';
  theme: 'dark' | 'light';
  tab: Tab;
  dock: boolean;
  compare: string[];
}

export const YEAR_MAX = new Date().getUTCFullYear() + 1;
export const DEFAULTS: State = {
  slab: null, section: null, autoAz: true, ve: 1, slab2Color: 'depth',
  layers: { slabs: true, slab2: true, quakes: true, boundaries: true, shells: true, graticule: false },
  surfaceOpacity: 0.35,
  quakes: { magMin: 5, magMax: 9.6, yrMin: 1973, yrMax: YEAR_MAX, depMin: 0, depMax: 800 },
  time: 0, timeMode: 'filter', theme: 'dark', tab: 'section', dock: false, compare: [],
};

type Listener = (s: State, changed: Set<keyof State>) => void;
export class Store {
  private s: State;
  private listeners: Listener[] = [];
  constructor(init: State) { this.s = init; }
  get state(): Readonly<State> { return this.s; }
  set(patch: Partial<State>) {
    const changed = new Set<keyof State>();
    for (const k of Object.keys(patch) as (keyof State)[]) if (JSON.stringify(patch[k]) !== JSON.stringify(this.s[k])) changed.add(k);
    if (!changed.size) return;
    this.s = { ...this.s, ...patch };
    for (const l of this.listeners) l(this.s, changed);
  }
  /** Call fn now and whenever one of keys changes. */
  on(keys: (keyof State)[], fn: (s: State) => void) {
    this.listeners.push((s, ch) => { if (keys.some((k) => ch.has(k))) fn(s); });
    fn(this.s);
  }
}

// ---------- URL (hash) serialisation ----------
const LAYER_CODES: Record<LayerKey, string> = { slabs: 's', slab2: 'p', quakes: 'q', boundaries: 'b', shells: 'm', graticule: 'g' };
const r1 = (x: number) => +x.toFixed(1), r2 = (x: number) => +x.toFixed(2);

export function toHash(s: State, camera?: number[]): string {
  const p = new URLSearchParams();
  if (s.slab) p.set('slab', s.slab);
  if (s.section) p.set('sec', [r2(s.section.lon), r2(s.section.lat), r1(s.section.az), Math.round(s.section.halfLengthKm), Math.round(s.section.halfWidthKm)].join(','));
  if (s.section && !s.autoAz) p.set('az', 'manual');
  if (s.ve !== 1) p.set('ve', String(s.ve));
  if (s.slab2Color !== 'depth') p.set('s2c', s.slab2Color);
  const lay = (Object.keys(LAYER_CODES) as LayerKey[]).filter((k) => s.layers[k]).map((k) => LAYER_CODES[k]).join('');
  if (lay !== 'spqbm') p.set('lay', lay || '-');
  if (s.surfaceOpacity !== DEFAULTS.surfaceOpacity) p.set('op', String(r2(s.surfaceOpacity)));
  const q = s.quakes, d = DEFAULTS.quakes;
  if (q.magMin !== d.magMin || q.magMax !== d.magMax) p.set('mag', `${q.magMin},${q.magMax}`);
  if (q.yrMin !== d.yrMin || q.yrMax !== d.yrMax) p.set('yr', `${q.yrMin},${q.yrMax}`);
  if (q.depMin !== d.depMin || q.depMax !== d.depMax) p.set('dep', `${q.depMin},${q.depMax}`);
  if (s.time) p.set('t', String(s.time));
  if (s.timeMode !== 'filter') p.set('tm', s.timeMode);
  if (s.theme !== 'dark') p.set('th', s.theme);
  if (s.dock) p.set('tab', s.tab);
  if (s.compare.length) p.set('cmp', s.compare.join(','));
  if (camera) p.set('cam', camera.map((x) => x.toFixed(3)).join(','));
  const str = p.toString().replace(/%2C/g, ',');
  return str ? '#' + str : '';
}

export function fromHash(hash: string): { patch: Partial<State>; camera?: number[] } {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const patch: Partial<State> = {};
  const nums = (k: string, n: number) => { const v = p.get(k)?.split(',').map(Number); return v && v.length === n && v.every(Number.isFinite) ? v : null; };
  const slab = p.get('slab'); if (slab) patch.slab = slab;
  const sec = nums('sec', 5);
  if (sec) patch.section = { lon: sec[0], lat: sec[1], az: sec[2], halfLengthKm: sec[3], halfWidthKm: sec[4] };
  if (p.get('az') === 'manual') patch.autoAz = false;
  const ve = Number(p.get('ve')); if ([1, 2, 5].includes(ve)) patch.ve = ve;
  const s2c = p.get('s2c'); if (s2c === 'thk' || s2c === 'unc') patch.slab2Color = s2c;
  const lay = p.get('lay');
  if (lay) patch.layers = Object.fromEntries((Object.keys(LAYER_CODES) as LayerKey[]).map((k) => [k, lay.includes(LAYER_CODES[k])])) as Record<LayerKey, boolean>;
  const op = Number(p.get('op')); if (p.has('op') && op >= 0 && op <= 1) patch.surfaceOpacity = op;
  const mag = nums('mag', 2), yr = nums('yr', 2), dep = nums('dep', 2);
  if (mag || yr || dep) {
    const d = DEFAULTS.quakes;
    patch.quakes = { magMin: mag?.[0] ?? d.magMin, magMax: mag?.[1] ?? d.magMax, yrMin: yr?.[0] ?? d.yrMin, yrMax: yr?.[1] ?? d.yrMax, depMin: dep?.[0] ?? d.depMin, depMax: dep?.[1] ?? d.depMax };
  }
  const t = Number(p.get('t')); if (t > 0 && t <= 300) patch.time = t;
  if (p.get('tm') === 'advect') patch.timeMode = 'advect';
  if (p.get('th') === 'light') patch.theme = 'light';
  const tab = p.get('tab') as Tab | null;
  if (tab && ['section', 'depthage', 'rates', 'seismicity', 'prem'].includes(tab)) { patch.tab = tab; patch.dock = true; }
  const cmp = p.get('cmp'); if (cmp) patch.compare = cmp.split(',').slice(0, 3);
  const cam = nums('cam', 6);
  return { patch, camera: cam ?? undefined };
}
