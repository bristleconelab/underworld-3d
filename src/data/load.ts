// Fetch, decode and validate every data file. Slab2 and PB2002 are optional (the page works without them).

import type { Slab } from '../science/slabs';
import { decodeBoundaries, decodePlate, decodeQuakes, type Boundaries, type PlateMesh, type Quakes } from './decode';
import { validateQuakes, validateSlabs } from './schema';
import { SlabIndex } from './spatial';

export interface Crossref { zone: string; distKm: number; dipAz: number | null; azConsistency: number }
export interface QuakeMeta { source: string; fetched: string; count: number; magTypes: string[]; stride: number }
export interface Data {
  slabs: Slab[]; byAbbr: Map<string, Slab>; slabSource: string; rateCheck: { abbr: string; field: string; table: number; depthOverMeanAge: number }[];
  quakes: Quakes; quakeMeta: QuakeMeta;
  plates: PlateMesh[]; crossref: Record<string, Crossref>; slabIndex: SlabIndex | null; thkDefault: Set<string>;
  boundaries: Boundaries | null;
  problems: string[];
}

const base = import.meta.env.BASE_URL;
const get = async (p: string) => { const r = await fetch(base + p); if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r; };

export async function loadCore(): Promise<Pick<Data, 'slabs' | 'byAbbr' | 'slabSource' | 'rateCheck' | 'quakes' | 'quakeMeta' | 'problems'>> {
  const [sj, qm, qb] = await Promise.all([
    get('data/slabs.json').then((r) => r.json()),
    get('data/quakes.json').then((r) => r.json() as Promise<QuakeMeta>),
    get('data/quakes.bin').then((r) => r.arrayBuffer()),
  ]);
  const slabs = sj.slabs as Slab[];
  const quakes = decodeQuakes(qb, qm.magTypes);
  const problems = [...validateSlabs(slabs), ...validateQuakes(quakes)];
  return { slabs, byAbbr: new Map(slabs.map((s) => [s.abbr, s])), slabSource: sj.source, rateCheck: sj.rateCheck ?? [], quakes, quakeMeta: qm, problems };
}

export async function loadPlates(): Promise<Pick<Data, 'plates' | 'crossref' | 'slabIndex' | 'thkDefault'>> {
  const idx = await get('data/plates/index.json').then((r) => r.json()) as { zones: { name: string; file: string; nv: number; nt: number; thkDefault?: boolean }[]; atlas: Record<string, Crossref> };
  const plates = await Promise.all(idx.zones.map(async (z) => decodePlate(z.name, await get(`data/plates/${z.file}`).then((r) => r.arrayBuffer()), z.nv, z.nt)));
  return { plates, crossref: idx.atlas ?? {}, slabIndex: new SlabIndex(plates), thkDefault: new Set(idx.zones.filter((z) => z.thkDefault).map((z) => z.name)) };
}

export async function loadBoundaries(): Promise<Boundaries> {
  const [meta, buf] = await Promise.all([get('data/pb2002.json').then((r) => r.json()), get('data/pb2002.bin').then((r) => r.arrayBuffer())]);
  return decodeBoundaries(buf, meta.classes, meta.pairs);
}

let ids: Promise<string[]> | null = null;
/** USGS event ids, same order as quakes.bin; fetched the first time an event is inspected. */
export const quakeIds = () => (ids ??= get('data/quakes_ids.txt').then((r) => r.text()).then((t) => t.split('\n')));
