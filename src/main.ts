import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/source-serif-4';
import './styles.css';
import { decodeQuakes, fmt, isActive, rateWords, sinkingAt, sinkingStory, type Slab } from './earth';
import { Globe, type LayerName } from './globe';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const base = import.meta.env.BASE_URL;
const globe = new Globe($('#globe'));
const hint = $('#hint');
let slabs: Slab[] = [];

// ---------- data ----------
async function load() {
  const [sj, qb] = await Promise.all([
    fetch(`${base}data/slabs.json`).then((r) => r.json() as Promise<{ slabs: Slab[] }>),
    fetch(`${base}data/quakes.bin`).then((r) => r.arrayBuffer()),
  ]);
  slabs = sj.slabs;
  globe.setQuakes(decodeQuakes(qb));
  globe.setSlabs(slabs);
  buildList();
  applyHash();
  // Slab2 plates are optional: the site works without them
  try {
    const idx = await fetch(`${base}data/plates/index.json`).then((r) => (r.ok ? r.json() : null)) as { zones: { name: string; file: string; nv: number; nt: number }[] } | null;
    if (idx) {
      const meshes = await Promise.all(idx.zones.map(async (z) => {
        const buf = await fetch(`${base}data/plates/${z.file}`).then((r) => r.arrayBuffer());
        return { name: z.name, positions: new Float32Array(buf, 0, z.nv * 3), depths: new Float32Array(buf, z.nv * 12, z.nv), index: new Uint32Array(buf, z.nv * 16, z.nt * 3) };
      }));
      globe.setPlates(meshes);
    } else hidePlates();
  } catch { hidePlates(); }
}
const hidePlates = () => $('input[data-layer="plates"]').closest('li')!.remove();
load().catch((e) => { hint.textContent = 'The data did not load. Reload the page to try again.'; console.error(e); });

// ---------- controls ----------
const xray = $<HTMLInputElement>('#xray');
const applyXray = () => globe.setSurfaceOpacity(1 - Number(xray.value) / 100);
xray.addEventListener('input', applyXray);
applyXray();
document.querySelectorAll<HTMLInputElement>('input[data-layer]').forEach((cb) =>
  cb.addEventListener('change', () => globe.setVisible(cb.dataset.layer as LayerName, cb.checked)));

const time = $<HTMLInputElement>('#time'), timeLabel = $('#time-label'), timeReset = $('#time-reset');
const applyTime = () => {
  const t = Number(time.value);
  if (t === 0) { globe.setTime(null); timeLabel.textContent = 'Today: every slab'; timeReset.hidden = true; return; }
  const n = slabs.filter((s) => sinkingAt(s, t)).length;
  globe.setTime(t);
  timeLabel.textContent = `${fmt(t)} million years ago: ${n} ${n === 1 ? 'slab was' : 'slabs were'} going down`;
  timeReset.hidden = false;
};
time.addEventListener('input', applyTime);
timeReset.addEventListener('click', () => { time.value = '0'; applyTime(); });

// ---------- slab panel ----------
const panel = $('#panel'), body = $('#panel .panel-body');
const el = (tag: string, cls: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function showSlab(s: Slab | null) {
  globe.select(s);
  if (!s) { panel.hidden = true; globe.setViewShift(0); history.replaceState(null, '', location.pathname); return; }
  globe.setViewShift(matchMedia('(min-width: 901px)').matches ? 190 : 0);
  hint.hidden = true;
  history.replaceState(null, '', `#slab=${encodeURIComponent(s.abbr)}`);
  body.replaceChildren();
  const active = isActive(s);
  body.append(el('p', `badge ${active ? 'active' : 'sunk'}`, active ? 'Still sinking' : 'Gone down'), el('h2', '', s.name));
  const story = el('p', 'story');
  const depthTxt = s.top[0] === 0 ? `Today it reaches from the trench down to about ${fmt(s.base[0])} km` : `Today it lies between about ${fmt(s.top[0])} and ${fmt(s.base[0])} km down`;
  const rate = rateWords(s.rate[0]);
  story.textContent = `${sinkingStory(s)} ${depthTxt}, with its middle ${fmt(s.mid[2])} km below ${place(s.mid[1], s.mid[0])}.${rate ? ` On average it sank ${rate}.` : ''}`;
  body.append(story);
  const dl = el('dl', 'facts');
  const row = (k: string, v: string) => dl.append(el('dt', '', k), el('dd', '', v));
  row('Depth today', `${fmt(s.top[0])}–${fmt(s.base[0])} km (±${fmt(Math.max(s.top[1], s.base[1]))})`);
  row('Went down', active ? `since ${fmt(Math.round(s.ageBase[1]))} million years ago` : `${fmt(Math.round(s.ageBase[1]))}–${fmt(Math.round(s.ageTop[0]))} million years ago`);
  row('Where it went down', place(s.surface[1], s.surface[0]));
  body.append(dl);
  if (s.ageNote) body.append(el('p', 'fine', `Ages were given as geological periods (${s.ageNote.replace('ages given as ', '').replace(' in the source', '')}); shown here as their span in years.`));
  const go = el('button', 'btn small', 'Show where it went down') as HTMLButtonElement;
  go.addEventListener('click', () => globe.flyTowards(s.surface[0], s.surface[1], 2.2));
  body.append(go, el('p', 'fine', 'From the Atlas of the Underworld (van der Meer et al. 2018, CC BY 4.0). Depths ±100–200 km, ages ± a few million years.'));
  panel.hidden = false;
  panel.querySelector<HTMLElement>('.panel-body')!.scrollTop = 0;
}
const place = (lat: number, lon: number) => `${Math.abs(lat).toFixed(0)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(0)}° ${lon >= 0 ? 'E' : 'W'}`;

globe.onPick = (s) => { if (s) showSlab(s); };
const hover = $('#hover');
globe.onHover = (s) => { hover.textContent = s ? `${s.name}: ${fmt(s.mid[2])} km down` : ''; hover.hidden = !s; };
panel.querySelector('.close')!.addEventListener('click', () => showSlab(null));

// ---------- list and about ----------
function buildList() {
  const byDepth = [...slabs].sort((a, b) => a.mid[2] - b.mid[2]);
  for (const s of byDepth) {
    const b = el('button', 'slab-item') as HTMLButtonElement;
    b.append(el('span', 'nm', s.name), el('span', 'dp', `${fmt(s.mid[2])} km`));
    b.addEventListener('click', () => { ($('#list') as HTMLDialogElement).close(); showSlab(s); });
    const li = el('li', ''); li.append(b);
    $(isActive(s) ? '#list-active' : '#list-sunk').append(li);
  }
}
for (const [btn, dlg] of [['#list-open', '#list'], ['#about-open', '#about']] as const) {
  const d = $<HTMLDialogElement>(dlg);
  $(btn).addEventListener('click', () => d.showModal());
  d.querySelector('.close')!.addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden && !document.querySelector('dialog[open]')) showSlab(null); });

function applyHash() {
  const m = /slab=([^&]+)/.exec(location.hash);
  const s = m && slabs.find((x) => x.abbr === decodeURIComponent(m[1]));
  if (s) showSlab(s);
}
window.addEventListener('hashchange', applyHash);
(window as unknown as { __uw: unknown }).__uw = { globe };
