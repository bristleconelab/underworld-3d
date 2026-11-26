import '@fontsource-variable/bricolage-grotesque';
import './styles.css';
import { PLASMA, SLAB2_MODES } from './core/colormap';
import { fmt, latlon } from './core/format';
import { DEFAULTS, fromHash, Store, toHash, YEAR_MAX, type LayerKey, type State } from './core/store';
import { apa, bibtex, download, ris, slabRow, slabsGeoJson, SLAB_COLUMNS, toCsv } from './data/export';
import { loadBoundaries, loadCore, loadPlates, type Data } from './data/load';
import { Globe } from './render3d/globe';
import { fromXYZ } from './science/geodesy';
import { CLAPEYRON, phaseDeflectionKm, prem } from './science/prem';
import { inSwath, projectLonLat, sectionFrame, type Section } from './science/section';
import { magnitudeDiameterPx } from './science/seismology';
import { depthsAt, subductingAt } from './science/slabs';
import { forSection, initAnalysis, renderAnalysis, sectionCsv } from './ui/analysis';
import { $, el, toast, wireDialog, type Ctx } from './ui/dom';
import { closeInspector, plateCard, quakeCard, slabCard } from './ui/inspector';
import { initTable, showCompare } from './ui/table';

const init = fromHash(location.hash);
const store = new Store({ ...DEFAULTS, ...init.patch, layers: { ...DEFAULTS.layers, ...init.patch.layers } });
const globe = new Globe($('#globe'));
globe.onContextLost = () => ($('#ctxlost') as HTMLDialogElement).showModal();
const data = { slabs: [], byAbbr: new Map(), plates: [], crossref: {}, slabIndex: null, thkDefault: new Set(), boundaries: null, rateCheck: [], problems: [] } as unknown as Data;

const ctx: Ctx = {
  store, globe, data, sel: { quake: -1 }, toast,
  inspectSlab: (abbr) => selectSlab(abbr),
  inspectQuake: (i) => { ctx.sel.quake = i; void quakeCard(ctx, i); if (store.state.dock && store.state.tab === 'section') renderAnalysis(ctx, store.state); },
  inspectPlate: (h) => plateCard(ctx, h),
  refreshAnalysis: () => renderAnalysis(ctx, store.state),
};

// ---------- section ----------
const DEFAULT_AZ = 90;
function sectionForSlab(abbr: string, prev: Section | null, autoAz: boolean): Section {
  const s = data.byAbbr.get(abbr)!, xr = data.crossref[abbr];
  const az = autoAz ? (xr?.dipAz != null && xr.azConsistency >= 0.5 ? xr.dipAz : DEFAULT_AZ) : prev?.az ?? DEFAULT_AZ;
  return { lon: s.mid[0], lat: s.mid[1], az: Math.round(az), halfLengthKm: Math.round(Math.max(1000, Math.min(3000, s.base[0] * 0.8 + 500)) / 50) * 50, halfWidthKm: prev?.halfWidthKm ?? 150 };
}
function faceSection() {
  const s = store.state, sec = s.section; if (!sec) return;
  const sl = s.slab ? data.byAbbr.get(s.slab) : null;
  globe.frameSection(sectionFrame(sec), Math.max(800, sl ? sl.base[0] + sl.base[1] + 200 : 900));
}
function selectSlab(abbr: string | null) {
  ctx.sel.quake = -1;
  if (!abbr || !data.byAbbr.has(abbr)) {
    store.set({ slab: null, section: null }); closeInspector(); globe.select(null); globe.resetView(); return;
  }
  const s = store.state;
  store.set({ slab: abbr, section: sectionForSlab(abbr, s.section, s.autoAz), autoAz: s.autoAz });
  slabCard(ctx, data.byAbbr.get(abbr)!);
  globe.select(data.byAbbr.get(abbr)!);
  faceSection();
}

// ---------- left dock ----------
function initControls() {
  const left = $('#left'), btnLeft = $('#btn-left');
  if (matchMedia('(max-width: 900px)').matches) left.hidden = true;
  btnLeft.setAttribute('aria-expanded', String(!left.hidden));
  btnLeft.addEventListener('click', () => { left.hidden = !left.hidden; btnLeft.setAttribute('aria-expanded', String(!left.hidden)); window.dispatchEvent(new Event('docks')); });

  document.querySelectorAll<HTMLInputElement>('input[data-layer]').forEach((cb) => cb.addEventListener('change', () => store.set({ layers: { ...store.state.layers, [cb.dataset.layer as LayerKey]: cb.checked } })));
  const s2c = $<HTMLSelectElement>('#s2c');
  s2c.addEventListener('change', () => store.set({ slab2Color: s2c.value as State['slab2Color'] }));
  const op = $<HTMLInputElement>('#opacity');
  op.addEventListener('input', () => store.set({ surfaceOpacity: Number(op.value) / 100 }));

  const qi = (id: string) => $<HTMLInputElement>(id);
  const readQ = () => {
    const n = (id: string, d: number) => { const v = Number(qi(id).value); return Number.isFinite(v) && qi(id).value !== '' ? v : d; };
    const d = DEFAULTS.quakes;
    store.set({ quakes: { magMin: n('#q-mag0', d.magMin), magMax: n('#q-mag1', d.magMax), yrMin: n('#q-yr0', d.yrMin), yrMax: n('#q-yr1', d.yrMax), depMin: n('#q-dep0', d.depMin), depMax: n('#q-dep1', d.depMax) } });
  };
  for (const id of ['#q-mag0', '#q-mag1', '#q-yr0', '#q-yr1', '#q-dep0', '#q-dep1']) qi(id).addEventListener('change', readQ);
  qi('#q-yr0').max = qi('#q-yr1').max = String(YEAR_MAX);
  $('#q-reset').addEventListener('click', () => store.set({ quakes: { ...DEFAULTS.quakes } }));

  const az = qi('#sec-az'), w = qi('#sec-w'), l = qi('#sec-l'), ve = $<HTMLSelectElement>('#sec-ve'), auto = qi('#sec-auto');
  const patchSec = (p: Partial<Section>) => { const s = store.state.section; if (s) store.set({ section: { ...s, ...p } }); };
  az.addEventListener('input', () => { store.set({ autoAz: false }); patchSec({ az: Number(az.value) }); });
  w.addEventListener('input', () => patchSec({ halfWidthKm: Number(w.value) }));
  l.addEventListener('input', () => patchSec({ halfLengthKm: Number(l.value) }));
  ve.addEventListener('change', () => store.set({ ve: Number(ve.value) }));
  auto.addEventListener('change', () => {
    store.set({ autoAz: auto.checked });
    const s = store.state; if (auto.checked && s.slab) store.set({ section: sectionForSlab(s.slab, s.section, true) });
  });
  $('#sec-here').addEventListener('click', () => {
    const t = globe.controls.target.lengthSq() > 1e-6 ? globe.controls.target : globe.camera.position;
    const ll = fromXYZ(t.x, t.y, t.z);
    store.set({ slab: null, autoAz: false, section: { lon: +ll.lon.toFixed(2), lat: +ll.lat.toFixed(2), az: DEFAULT_AZ, halfLengthKm: 1500, halfWidthKm: store.state.section?.halfWidthKm ?? 150 } });
    globe.select(null); faceSection();
  });
  $('#sec-view').addEventListener('click', faceSection);
  $('#sec-close').addEventListener('click', () => { store.set({ section: null }); globe.resetView(); });

  const time = qi('#time');
  time.addEventListener('input', () => store.set({ time: Number(time.value) }));
  document.querySelectorAll<HTMLInputElement>('input[name="tmode"]').forEach((r) => r.addEventListener('change', () => store.set({ timeMode: r.value as State['timeMode'] })));

  // phase-boundary calculator
  const dT = qi('#pb-dt'), g4 = qi('#pb-g410'), g6 = qi('#pb-g660');
  g4.value = String(CLAPEYRON[410].default); g6.value = String(CLAPEYRON[660].default);
  $('#clap-refs').textContent = `γ410 ${CLAPEYRON[410].range.join(' to ')} (${CLAPEYRON[410].ref}); γ660 ${CLAPEYRON[660].range.join(' to ')} (${CLAPEYRON[660].ref}).`;
  const calc = () => {
    const t = Number(dT.value), a = phaseDeflectionKm(410, Number(g4.value), t), b = phaseDeflectionKm(660, Number(g6.value), t);
    const say = (d: number, z: number) => `${z} km boundary ${d < 0 ? 'raised' : 'depressed'} by ${fmt(Math.abs(d), 1)} km (to ${fmt(z + d)} km)`;
    $('#pb-out').textContent = `${say(a, 410)}; ${say(b, 660)}.`;
  };
  for (const i of [dT, g4, g6]) i.addEventListener('input', calc);
  calc();

  // magnitude legend
  const ml = $('#mag-legend');
  for (const m of [5, 6, 7, 8, 9]) { const d = magnitudeDiameterPx(m); ml.append(el('span', { class: 'mag' }, el('i', { style: `width:${d}px;height:${d}px` }), `${m}`)); }
}

function syncControls(s: State) {
  document.querySelectorAll<HTMLInputElement>('input[data-layer]').forEach((cb) => (cb.checked = s.layers[cb.dataset.layer as LayerKey]));
  $<HTMLInputElement>('#opacity').value = String(Math.round(s.surfaceOpacity * 100));
  $('#opacity-v').textContent = `${Math.round(s.surfaceOpacity * 100)}%`;
  $<HTMLInputElement>('#opacity').disabled = !!s.section;
  $('#opacity-note').hidden = !s.section;
  const q = s.quakes, set = (id: string, v: number) => { const i = $<HTMLInputElement>(id); if (document.activeElement !== i) i.value = String(v); };
  set('#q-mag0', q.magMin); set('#q-mag1', q.magMax); set('#q-yr0', q.yrMin); set('#q-yr1', q.yrMax); set('#q-dep0', q.depMin); set('#q-dep1', q.depMax);
  $('#sec-on').hidden = !s.section; $('#sec-off').hidden = !!s.section;
  if (s.section) {
    const sec = s.section;
    $<HTMLInputElement>('#sec-az').value = String(sec.az); $('#sec-az-v').textContent = `${fmt(sec.az)}°`;
    $<HTMLInputElement>('#sec-w').value = String(sec.halfWidthKm); $('#sec-w-v').textContent = `${fmt(sec.halfWidthKm)} km`;
    $<HTMLInputElement>('#sec-l').value = String(sec.halfLengthKm); $('#sec-l-v').textContent = `${fmt(sec.halfLengthKm)} km`;
    $<HTMLSelectElement>('#sec-ve').value = String(s.ve);
    $<HTMLInputElement>('#sec-auto').checked = s.autoAz;
    const xr = s.slab ? data.crossref[s.slab] : undefined;
    $('#sec-desc').textContent = `Centre ${latlon(sec.lat, sec.lon, 1)}${s.slab ? ` (${s.slab})` : ''}. ${s.autoAz && s.slab ? (xr?.dipAz != null && xr.azConsistency >= 0.5 ? `Azimuth = Slab2 ${xr.zone} down-dip direction.` : `No consistent Slab2 dip nearby: default ${DEFAULT_AZ}° (E–W); adjust.`) : 'Azimuth set by hand.'}`;
  }
  $<HTMLInputElement>('#time').value = String(s.time);
  $('#time-v').textContent = s.time ? `${s.time} Ma` : 'today';
  document.querySelectorAll<HTMLInputElement>('input[name="tmode"]').forEach((r) => (r.checked = r.value === s.timeMode));
  const n = s.time ? (s.timeMode === 'filter' ? data.slabs.filter((x) => subductingAt(x, s.time)).length : data.slabs.filter((x) => depthsAt(x, s.time)).length) : data.slabs.length;
  $('#time-note').textContent = s.time
    ? s.timeMode === 'filter'
      ? `${n} slabs were subducting at ${s.time} Ma (highlighted at today's positions). Earthquakes and Slab2 are present-day and dimmed.`
      : `${n} slabs had started subducting by ${s.time} Ma, drawn at z − v·t (vertical sinking at the Atlas rates; no lateral plate motion, continents stay present-day). Maldives has no ages and is hidden.`
    : 'Present day.';
  if (s.time) (document.querySelector('#time')!.closest('details') as HTMLDetailsElement).open = true;
  document.body.classList.toggle('light', s.theme === 'light');
  $('#btn-theme').textContent = s.theme === 'light' ? 'Dark' : 'Light';
}

function quakeCount(s: State) {
  const q = data.quakes; if (!q) return;
  const f = s.quakes; let n = 0;
  for (let i = 0; i < q.n; i++) if (q.mag[i] >= f.magMin - 1e-3 && q.mag[i] <= f.magMax + 1e-3 && q.depth[i] >= f.depMin && q.depth[i] <= f.depMax && q.year[i] >= f.yrMin && q.year[i] < f.yrMax) n++;
  $('#q-count').textContent = fmt(n);
}

// ---------- docks -> free viewport for the globe ----------
function updateInsets() {
  const r = (sel: string) => { const e = $(sel); return e && !e.hidden && e.getClientRects().length ? e.getBoundingClientRect() : null; };
  const wide = matchMedia('(min-width: 901px)').matches;
  const L = r('#left'), R = r('#inspector'), B = r('#analysis'), T = r('.topbar');
  // on narrow screens the inspector is a bottom sheet
  const bottom = Math.max(B ? innerHeight - B.top : 0, !wide && R ? innerHeight - R.top : 0);
  globe.setInsets({ left: wide && L ? L.right : 0, right: wide && R ? innerWidth - R.left : 0, top: T ? T.bottom : 0, bottom });
  const va = $('#viewaids'), hud = $('#hud');
  va.style.right = `${(wide && R ? innerWidth - R.left : 0) + 14}px`;
  va.style.bottom = hud.style.bottom = `${bottom + 12}px`;
  hud.style.left = `${(wide && L ? L.right : 0) + 14}px`;
}
window.addEventListener('docks', updateInsets); // synchronous: a camera fit right after a panel opens needs the new insets
window.addEventListener('resize', updateInsets);

// ---------- HUD ----------
globe.onCursor = (c) => {
  const hud = $('#hud');
  if (!c) { hud.textContent = ''; return; }
  const p = prem(c.depthKm);
  hud.textContent = `${latlon(c.lat, c.lon, 2)} · ${fmt(c.depthKm)} km${c.onSection ? ' (section)' : ''} · P ${fmt(p.pGPa, 1)} GPa · Vp ${fmt(p.vp, 2)} · Vs ${fmt(p.vs, 2)} km/s · ρ ${fmt(p.rho, 2)}`;
};
globe.onView = ({ northDeg, kmPerPx }) => {
  $('#compass').style.transform = `rotate(${-northDeg}deg)`;
  const target = kmPerPx * 110, mag = 10 ** Math.floor(Math.log10(target)), nice = [1, 2, 5, 10].map((m) => m * mag).filter((v) => v <= target).pop() ?? mag;
  $('#scalebar i').style.width = `${nice / kmPerPx}px`;
  $('#scalebar span').textContent = `${fmt(nice)} km at view centre`;
};
const hover = $('#hover');
globe.onHoverSlab = (s) => { hover.textContent = s ? `${s.name} (${s.abbr}) · ${fmt(s.top[0])}–${fmt(s.base[0])} km` : ''; };
globe.onSlab = (s) => s && selectSlab(s.abbr);
globe.onQuake = (i) => ctx.inspectQuake(i);
globe.onPlate = (h) => ctx.inspectPlate(h);
$('#inspector .close').addEventListener('click', () => { closeInspector(); });

// ---------- top bar, dialogs ----------
function initTopbar() {
  const search = $<HTMLInputElement>('#search');
  const go = () => {
    const v = search.value.trim().toLowerCase(); if (!v) return;
    const s = data.slabs.find((x) => x.abbr.toLowerCase() === v || x.name.toLowerCase() === v) ?? data.slabs.find((x) => x.name.toLowerCase().includes(v));
    if (s) { selectSlab(s.abbr); search.value = ''; search.blur(); } else toast(`No slab matches “${search.value}”.`);
  };
  search.addEventListener('change', go);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  for (const id of ['#table', '#compare', '#export', '#cite', '#about']) wireDialog($<HTMLDialogElement>(id));
  $('#btn-about').addEventListener('click', () => $<HTMLDialogElement>('#about').showModal());
  $('#btn-export').addEventListener('click', () => $<HTMLDialogElement>('#export').showModal());
  $('#btn-theme').addEventListener('click', () => store.set({ theme: store.state.theme === 'dark' ? 'light' : 'dark' }));
  $('#btn-link').addEventListener('click', async () => {
    const url = location.origin + location.pathname + toHash(store.state, globe.getCamera());
    history.replaceState(null, '', url);
    try { await navigator.clipboard.writeText(url); toast('Permalink copied (includes the camera).'); } catch { toast('Permalink is in the address bar.'); }
  });
  // cite
  const fmts = { bibtex, ris, apa } as const; let cur: keyof typeof fmts = 'bibtex';
  const show = () => { $('#cite-text').textContent = fmts[cur](); document.querySelectorAll<HTMLButtonElement>('#cite [data-fmt]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.fmt === cur))); };
  document.querySelectorAll<HTMLButtonElement>('#cite [data-fmt]').forEach((b) => b.addEventListener('click', () => { cur = b.dataset.fmt as typeof cur; show(); }));
  $('#btn-cite').addEventListener('click', () => { show(); $<HTMLDialogElement>('#cite').showModal(); });
  $('#cite-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(fmts[cur]()); toast('Copied.'); } catch { toast('Select the text to copy it.'); } });
  $('#cite-dl').addEventListener('click', () => download(`underworld-references.${cur === 'bibtex' ? 'bib' : cur === 'ris' ? 'ris' : 'txt'}`, fmts[cur](), 'text/plain'));
  // export
  $('#export').addEventListener('click', async (e) => {
    const x = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-x]')?.dataset.x; if (!x) return;
    const s = store.state, z2 = (a: string) => data.crossref[a]?.zone;
    if (x === 'slabs-csv') download('underworld-slabs.csv', `# ${data.slabSource}\n` + toCsv(SLAB_COLUMNS, data.slabs.map((sl) => slabRow(sl, z2(sl.abbr)))), 'text/csv');
    if (x === 'slabs-geojson') download('underworld-slabs.geojson', JSON.stringify({ ...slabsGeoJson(data.slabs, z2), source: data.slabSource }), 'application/geo+json');
    if (x === 'quakes-csv') {
      const q = data.quakes, f = s.quakes, fr = s.section ? sectionFrame(s.section) : null, rows: unknown[][] = [];
      for (let i = 0; i < q.n; i++) {
        if (!(q.mag[i] >= f.magMin - 1e-3 && q.mag[i] <= f.magMax + 1e-3 && q.depth[i] >= f.depMin && q.depth[i] <= f.depMax && q.year[i] >= f.yrMin && q.year[i] < f.yrMax)) continue;
        if (fr && !inSwath(fr, projectLonLat(fr, q.lon[i], q.lat[i], q.depth[i]))) continue;
        rows.push([new Date(q.time[i] * 1000).toISOString(), q.lat[i], q.lon[i], q.depth[i], q.depthErr[i], q.horErr[i], q.mag[i], q.magTypes[q.magType[i]]]);
      }
      download('underworld-earthquakes.csv', `# ${data.quakeMeta.source}, fetched ${data.quakeMeta.fetched}\n` + toCsv(['time_utc', 'lat', 'lon', 'depth_km', 'depth_err_km', 'horizontal_err_km', 'mag', 'mag_type'], rows), 'text/csv');
    }
    if (x === 'section-csv') { const d = forSection(ctx); if (!d || !s.section) return toast('Open a cross-section first.'); download('underworld-section.csv', sectionCsv(ctx, s.section, d), 'text/csv'); }
    if (x === 'chart-svg' || x === 'chart-png') { if (!s.dock) { store.set({ dock: true }); await new Promise((r) => setTimeout(r, 50)); } ($(x === 'chart-svg' ? '#chart-svg' : '#chart-png') as HTMLButtonElement).click(); }
    if (x === 'globe-png') download('underworld-3d.png', await globe.capture(2, s.theme === 'light' ? '#f6f4ef' : '#0b0e1a'), 'image/png');
    if (x === 'state-json') download('underworld-view.json', JSON.stringify({ state: s, camera: globe.getCamera(), url: location.origin + location.pathname + toHash(s, globe.getCamera()) }, null, 2), 'application/json');
  });
}

// ---------- state -> everything ----------
function wire() {
  store.on(['layers'], (s) => (Object.keys(s.layers) as LayerKey[]).forEach((k) => globe.setLayer(k, s.layers[k])));
  store.on(['surfaceOpacity'], (s) => globe.setSurfaceOpacity(s.surfaceOpacity));
  store.on(['slab2Color'], (s) => {
    globe.setPlateColor(s.slab2Color);
    const m = SLAB2_MODES[s.slab2Color], lg = $('#s2-legend');
    $<HTMLSelectElement>('#s2c').value = s.slab2Color;
    lg.querySelector('span')!.textContent = m.label;
    (lg.querySelector('.bar') as HTMLElement).className = `bar ${m.map === PLASMA ? 'plasma' : 'viridis'}`;
    lg.querySelectorAll('.ticks b').forEach((b, i) => (b.textContent = fmt(m.range[0] + ((m.range[1] - m.range[0]) * i) / 2)));
  });
  store.on(['quakes'], (s) => { globe.setQuakeFilter(s.quakes); quakeCount(s); });
  store.on(['time', 'timeMode'], (s) => globe.setSlabTime(s.time, s.timeMode));
  store.on(['section'], (s) => globe.setSection(s.section ? sectionFrame(s.section) : null));
  store.on(['layers', 'surfaceOpacity', 'quakes', 'section', 'autoAz', 've', 'time', 'timeMode', 'theme', 'slab'], syncControls);
  store.on(['dock', 'tab', 'section', 've', 'quakes', 'slab', 'compare'], (s) => renderAnalysis(ctx, s));
  let t = 0;
  store.on(['slab', 'section', 'autoAz', 've', 'slab2Color', 'layers', 'surfaceOpacity', 'quakes', 'time', 'timeMode', 'theme', 'tab', 'dock', 'compare'], (s) => {
    clearTimeout(t); t = window.setTimeout(() => history.replaceState(null, '', location.pathname + toHash(s)), 250);
  });
}

async function main() {
  initControls(); initTopbar(); initAnalysis(ctx); initTable(ctx);
  const core = await loadCore();
  Object.assign(data, core);
  if (core.problems.length) { console.error('data validation', core.problems); toast(`Data check found ${core.problems.length} problem(s); see the console.`); }
  $('#about-quakes').textContent = `${fmt(core.quakes.n)} events, fetched ${core.quakeMeta.fetched}`;
  const dl = $('#slab-names');
  for (const s of core.slabs) dl.append(el('option', { value: s.name }, s.abbr));
  globe.setQuakes(core.quakes);
  globe.setSlabs(core.slabs);
  wire();
  // optional layers: when they arrive they take the current state (layer toggles, time, section clipping)
  const [plates, bounds] = await Promise.allSettled([loadPlates(), loadBoundaries()]);
  if (plates.status === 'fulfilled') { Object.assign(data, plates.value); globe.thkDefault = plates.value.thkDefault; globe.setPlates(plates.value.plates); }
  else { console.warn('Slab2 not loaded', plates.reason); $('input[data-layer="slab2"]').closest('li')!.remove(); }
  if (bounds.status === 'fulfilled') { data.boundaries = bounds.value; globe.setBoundaries(bounds.value); }
  else { console.warn('PB2002 not loaded', bounds.reason); $('input[data-layer="boundaries"]').closest('li')!.remove(); }
  const s = store.state;
  (Object.keys(s.layers) as LayerKey[]).forEach((k) => globe.setLayer(k, s.layers[k]));
  globe.setSlabTime(s.time, s.timeMode);
  globe.setSection(s.section ? sectionFrame(s.section) : null);
  renderAnalysis(ctx, s); syncControls(s);
  // deep link
  if (s.slab && data.byAbbr.has(s.slab)) {
    const keep = init.patch.section;
    selectSlab(s.slab);
    if (keep) { store.set({ section: keep }); if (!init.camera) faceSection(); }
  } else if (s.section && !init.camera) faceSection();
  if (init.camera) globe.setCamera(init.camera);
  if (s.compare.length >= 2 && location.hash.includes('cmp=') && !s.slab) showCompare(ctx);
  updateInsets();
  document.body.classList.add('ready');
}
main().catch((e) => { console.error(e); toast('The data did not load. Reload the page to try again.'); });

window.addEventListener('hashchange', () => {
  const { patch } = fromHash(location.hash);
  if (patch.slab && patch.slab !== store.state.slab) selectSlab(patch.slab);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (!$('#inspector').hidden) closeInspector(); else if (store.state.section) { store.set({ section: null, slab: null }); globe.select(null); globe.resetView(); }
});
(window as unknown as { __uw: unknown }).__uw = { globe, store, data };
