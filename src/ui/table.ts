// Slab catalogue: searchable, sortable, filterable data grid with compare selection and export.

import { fmt } from '../core/format';
import { download, slabRow, slabsGeoJson, SLAB_COLUMNS, toCsv } from '../data/export';
import { isActive, regime, type Slab } from '../science/slabs';
import { $, el, type Ctx } from './dom';

type Col = { key: string; label: string; get: (s: Slab) => number | string | null; num?: boolean; f?: (v: number) => string };
const r = (a: [number, number] | null, i: 0 | 1) => (a ? a[i] : null);
const COLS: Col[] = [
  { key: 'nr', label: '#', get: (s) => s.nr, num: true },
  { key: 'name', label: 'Slab', get: (s) => s.name },
  { key: 'abbr', label: 'Abbr', get: (s) => s.abbr },
  { key: 'status', label: 'Status', get: (s) => (isActive(s) ? 'active' : 'detached') },
  { key: 'mid', label: 'Mid km', get: (s) => s.mid[2], num: true },
  { key: 'top', label: 'Top km', get: (s) => s.top[0], num: true },
  { key: 'base', label: 'Base km', get: (s) => s.base[0], num: true },
  { key: 'onset', label: 'Onset Ma', get: (s) => r(s.ageBase, 1), num: true, f: (v) => fmt(v, 1) },
  { key: 'end', label: 'End Ma', get: (s) => r(s.ageTop, 0), num: true, f: (v) => fmt(v, 1) },
  { key: 'rb', label: 'v base mm/yr', get: (s) => r(s.rateBase, 0), num: true, f: (v) => fmt(v, 1) },
  { key: 'rt', label: 'v top mm/yr', get: (s) => r(s.rateTop, 0), num: true, f: (v) => fmt(v, 1) },
  { key: 'lat', label: 'Lat', get: (s) => s.mid[1], num: true, f: (v) => fmt(v, 1) },
  { key: 'lon', label: 'Lon', get: (s) => s.mid[0], num: true, f: (v) => fmt(v, 1) },
  { key: 'slab2', label: 'Slab2', get: () => null },
];

export function initTable(ctx: Ctx) {
  const dlg = $<HTMLDialogElement>('#table'), thead = $('#table thead'), tbody = $('#table tbody');
  const q = $<HTMLInputElement>('#t-q'), st = $<HTMLSelectElement>('#t-status'), rg = $<HTMLSelectElement>('#t-regime');
  const cmpBtn = $<HTMLButtonElement>('#t-compare');
  let sortKey = 'mid', asc = true;
  const z2 = (s: Slab) => ctx.data.crossref[s.abbr]?.zone ?? '';
  COLS[COLS.length - 1].get = z2;

  const rows = () => {
    const text = q.value.trim().toLowerCase();
    const col = COLS.find((c) => c.key === sortKey)!;
    return ctx.data.slabs
      .filter((s) => (!text || s.name.toLowerCase().includes(text) || s.abbr.toLowerCase().includes(text)) && (!st.value || (st.value === 'active') === isActive(s)) && (!rg.value || regime(s) === rg.value))
      .sort((a, b) => {
        const va = col.get(a), vb = col.get(b);
        if (va == null) return 1; if (vb == null) return -1;
        return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * (asc ? 1 : -1);
      });
  };
  const head = () => {
    const tr = el('tr', {}, el('th', { scope: 'col', title: 'Compare (up to 3)' }, '⇄'));
    for (const c of COLS) {
      const th = el('th', { scope: 'col', class: c.num ? 'n' : '', 'aria-sort': c.key === sortKey ? (asc ? 'ascending' : 'descending') : 'none' });
      const b = el('button', { class: 'sort' }, c.label + (c.key === sortKey ? (asc ? ' ▲' : ' ▼') : ''));
      b.addEventListener('click', () => { if (sortKey === c.key) asc = !asc; else { sortKey = c.key; asc = true; } render(); });
      th.append(b); tr.append(th);
    }
    thead.replaceChildren(tr);
  };
  const render = () => {
    head();
    const list = rows(), cmp = ctx.store.state.compare;
    $('#t-n').textContent = `${list.length} of ${ctx.data.slabs.length}`;
    tbody.replaceChildren(...list.map((s) => {
      const cb = el('input', { type: 'checkbox', 'aria-label': `Compare ${s.name}` }) as HTMLInputElement;
      cb.checked = cmp.includes(s.abbr);
      cb.addEventListener('change', () => {
        const c = ctx.store.state.compare.filter((a) => a !== s.abbr);
        ctx.store.set({ compare: cb.checked ? [...c, s.abbr].slice(-3) : c });
        render();
      });
      const tr = el('tr', {}, el('td', {}, cb));
      for (const c of COLS) {
        const v = c.get(s);
        const td = el('td', { class: c.num ? 'n' : '' }, v == null ? '–' : typeof v === 'number' ? (c.f ? c.f(v) : fmt(v)) : v);
        if (c.key === 'name') { const b = el('button', { class: 'link' }, s.name); b.addEventListener('click', () => { dlg.close(); ctx.inspectSlab(s.abbr); }); td.replaceChildren(b); }
        if (c.key === 'status') td.className = isActive(s) ? 'st-a' : 'st-d';
        tr.append(td);
      }
      return tr;
    }));
    cmpBtn.disabled = cmp.length < 2;
    cmpBtn.textContent = `Compare selected (${cmp.length})`;
  };
  for (const i of [q, st, rg]) i.addEventListener('input', render);
  $('#btn-table').addEventListener('click', () => { render(); dlg.showModal(); });
  cmpBtn.addEventListener('click', () => showCompare(ctx));
  $('#t-csv').addEventListener('click', () => download('underworld-slabs.csv', `# ${ctx.data.slabSource}\n` + toCsv(SLAB_COLUMNS, rows().map((s) => slabRow(s, z2(s)))), 'text/csv'));
  $('#t-geojson').addEventListener('click', () => download('underworld-slabs.geojson', JSON.stringify({ ...slabsGeoJson(rows(), (a) => ctx.data.crossref[a]?.zone), source: ctx.data.slabSource }), 'application/geo+json'));
}

export function showCompare(ctx: Ctx) {
  const slabs = ctx.store.state.compare.map((a) => ctx.data.byAbbr.get(a)).filter(Boolean) as Slab[];
  const dlg = $<HTMLDialogElement>('#compare');
  const t = el('table', { class: 'grid num cmp' });
  t.append(el('tr', {}, el('th', {}, ''), ...slabs.map((s) => el('th', {}, s.name))));
  const rowsDef: [string, (s: Slab) => string][] = [
    ['Status', (s) => (isActive(s) ? 'active' : 'detached')], ['Regime', regime],
    ['Midpoint depth', (s) => `${fmt(s.mid[2])} km`], ['Top', (s) => `${fmt(s.top[0])} ± ${fmt(s.top[1])} km`], ['Base', (s) => `${fmt(s.base[0])} ± ${fmt(s.base[1])} km`],
    ['Onset', (s) => (s.ageBase ? `${fmt(s.ageBase[0], 1)}–${fmt(s.ageBase[1], 1)} Ma` : '–')], ['End', (s) => (isActive(s) ? 'ongoing' : s.ageTop ? `${fmt(s.ageTop[0], 1)}–${fmt(s.ageTop[1], 1)} Ma` : '–')],
    ['v base', (s) => (s.rateBase ? `${fmt(s.rateBase[0], 1)} ± ${fmt(s.rateBase[1], 1)} mm/yr` : '–')], ['v top', (s) => (s.rateTop ? `${fmt(s.rateTop[0], 1)} ± ${fmt(s.rateTop[1], 1)} mm/yr` : '–')],
    ['Midpoint', (s) => `${fmt(s.mid[1], 1)}°, ${fmt(s.mid[0], 1)}°`], ['Slab2 zone', (s) => ctx.data.crossref[s.abbr]?.zone ?? '–'],
  ];
  for (const [k, f] of rowsDef) t.append(el('tr', {}, el('th', { scope: 'row' }, k), ...slabs.map((s) => el('td', {}, f(s)))));
  const go = el('button', { class: 'btn small' }, 'Show them on the depth–age plot');
  go.addEventListener('click', () => { dlg.close(); ($('#table') as HTMLDialogElement).close(); ctx.store.set({ dock: true, tab: 'depthage' }); });
  $('.cmp-body', dlg).replaceChildren(t, el('div', { class: 'btns' }, go));
  if (!dlg.open) dlg.showModal();
}
