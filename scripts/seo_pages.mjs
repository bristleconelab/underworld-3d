// Static, crawlable pages beside the WebGL app (search engines cannot read the globe):
//   public/slabs/index.html            the 100-slab catalogue as a table (+ Dataset and Breadcrumb JSON-LD)
//   public/slabs/<slug>/index.html     one page per slab: facts from slabs.json, link into the 3D section view
//   public/sitemap.xml, public/robots.txt
// Every number comes from public/data/slabs.json and public/data/plates/index.json, so the pages cannot drift from the
// app. usage: node scripts/seo_pages.mjs   (rerun after a data rebuild; commit the output; test/seo.test.ts checks it)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const SITE = 'https://underworld.bristleconelab.org';
const UPDATED = '2026-11-26';
const { slabs, source } = JSON.parse(readFileSync('public/data/slabs.json', 'utf8'));
const plates = JSON.parse(readFileSync('public/data/plates/index.json', 'utf8'));

export const slug = (name) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const n = (v, d = 0) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const ll = (lat, lon) => `${n(Math.abs(lat), 1)}° ${lat >= 0 ? 'N' : 'S'}, ${n(Math.abs(lon), 1)}° ${lon >= 0 ? 'E' : 'W'}`;
const rng = (r) => (r[0] === r[1] ? `${n(r[0], 1)} Ma` : `${n(r[0], 1)}–${n(r[1], 1)} Ma`);
const active = (s) => s.top[0] === 0 && s.ageTop?.[0] === 0;
const regime = (s) => (s.base[0] <= 660 ? 'upper mantle' : s.top[0] < 660 ? 'upper and lower mantle' : 'lower mantle');

const CSS = `:root{color-scheme:dark;--bg:#0b0e1a;--panel:#121729;--line:rgba(233,236,244,.13);--ink:#e9ecf4;--muted:#9aa3b8;--accent:#f0a04b;--link:#7fc8ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}a{color:var(--link)}
header,main,footer{max-width:860px;margin:0 auto;padding:16px}header{display:flex;justify-content:space-between;align-items:center;gap:12px}header a.brand{color:var(--ink);font-weight:750;text-decoration:none;font-size:19px}
.cta{display:inline-block;background:var(--accent);color:#1a1206;font-weight:650;text-decoration:none;padding:9px 16px;border-radius:6px}
h1{font-size:clamp(28px,5vw,40px);line-height:1.1;margin:8px 0 12px;letter-spacing:-.02em}h2{font-size:21px;margin:32px 0 8px}.lede{font-size:18px;color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:14.5px}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
th[scope=row]{color:var(--muted);font-weight:500;width:38%}.crumbs{font-size:14px;color:var(--muted)}.crumbs a{color:var(--muted)}.note{font-size:14px;color:var(--muted)}
pre{white-space:pre-wrap;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;font-size:13px}nav.pn{display:flex;justify-content:space-between;gap:12px;margin-top:28px}
footer{color:var(--muted);font-size:14px;border-top:1px solid var(--line);margin-top:24px}.wrap{overflow-x:auto}`;

const CITE = 'van der Meer, D. G., van Hinsbergen, D. J. J., & Spakman, W. (2018). Atlas of the underworld: Slab remnants in the mantle, their sinking history, and a new outlook on lower mantle viscosity. Tectonophysics, 723, 309–448. https://doi.org/10.1016/j.tecto.2017.10.004';

function page({ path, title, description, body, jsonld = [] }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${path}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}${path}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0b0e1a">
<style>${CSS}</style>
${jsonld.map(ld).join('\n')}
</head>
<body>
<header><a class="brand" href="/">Underworld 3D</a><a class="cta" href="/">Open the 3D globe</a></header>
<main>
${body}
</main>
<footer>Data: ${esc(source)}. Site by <a href="https://bristleconelab.org">Bristlecone Lab</a> · code <a href="https://github.com/bristleconelab/underworld-3d">github.com/bristleconelab/underworld-3d</a> (MIT) · updated ${UPDATED}.</footer>
</body>
</html>
`;
}

const byDepth = [...slabs].sort((a, b) => a.mid[2] - b.mid[2]);
const zoneFor = (abbr) => plates.atlas?.[abbr];

function lede(s) {
  const z = zoneFor(s.abbr);
  const parts = [
    `The ${s.name} slab (${s.abbr}) is ${active(s) ? 'a slab still subducting today' : 'a detached slab remnant'} in the ${regime(s)}, mapped by seismic tomography in the Atlas of the Underworld.`,
    `It reaches from ${s.top[0] === 0 ? 'the surface' : `${n(s.top[0])} ± ${n(s.top[1])} km`} to ${n(s.base[0])} ± ${n(s.base[1])} km depth, with its midpoint ${n(s.mid[2])} km below ${ll(s.mid[1], s.mid[0])}.`,
  ];
  if (s.ageBase) parts.push(active(s) ? `Its subduction began at ${rng(s.ageBase)} and continues today.` : `It subducted from ${rng(s.ageBase)} (onset) until ${rng(s.ageTop)} (end).`);
  else parts.push('The Atlas gives no age estimate for this slab.');
  if (s.rateBase) parts.push(`Its base sank at an average ${n(s.rateBase[0], 1)} ± ${n(s.rateBase[1], 1)} mm/yr.`);
  if (z) parts.push(`At the surface it connects to the ${z.zone} subduction zone of Slab2.`);
  return parts.join(' ');
}

function slabPage(s, i) {
  const path = `/slabs/${slug(s.name)}/`, z = zoneFor(s.abbr);
  const rows = [
    ['Catalogue number', `${s.nr} (${s.abbr})${s.updated ? `, updated ${s.updated}` : ''}`],
    ['Status', active(s) ? 'Active subduction (top at the surface, 0 Ma)' : 'Detached slab remnant'],
    ['Depth regime', regime(s)],
    ['Midpoint', `${ll(s.mid[1], s.mid[0])}, ${n(s.mid[2])} km deep`],
    ['Top depth', `${n(s.top[0])} ± ${n(s.top[1])} km`],
    ['Base depth', `${n(s.base[0])} ± ${n(s.base[1])} km`],
    ['Onset of subduction (base age)', s.ageBase ? rng(s.ageBase) : 'not estimated'],
    ['End of subduction (top age)', active(s) ? 'ongoing' : s.ageTop ? rng(s.ageTop) : 'not estimated'],
    ['Average sinking rate, base', s.rateBase ? `${n(s.rateBase[0], 1)} ± ${n(s.rateBase[1], 1)} mm/yr` : 'not estimated'],
    ['Average sinking rate, top', s.rateTop ? `${n(s.rateTop[0], 1)} ± ${n(s.rateTop[1], 1)} mm/yr${s.topRateNote ? ' (not depth ÷ age; see the source)' : ''}` : 'not estimated'],
    ['Geological record at the surface', s.surface ? ll(s.surface[1], s.surface[0]) : 'not known'],
    ['Slab2 subduction zone', z ? `${z.zone}${z.dipAz != null ? `, down-dip azimuth ${n(z.dipAz)}°` : ''}` : 'none (slab below 660 km or no Slab2 zone within 400 km)'],
  ];
  const prev = byDepth[i - 1], next = byDepth[i + 1];
  const app = `/#slab=${encodeURIComponent(s.abbr)}&tab=section`;
  const desc = `${s.name} slab (${s.abbr}): ${active(s) ? 'active subduction' : 'detached remnant'}, ${n(s.top[0])}–${n(s.base[0])} km deep under ${ll(s.mid[1], s.mid[0])}${s.ageBase ? `, subduction since ${n(s.ageBase[1], 0)} Ma` : ''}. Depth, age, sinking rate and a 3D cross-section.`;
  const body = `<p class="crumbs"><a href="/">Underworld 3D</a> › <a href="/slabs/">Slabs</a> › ${esc(s.name)}</p>
<h1>${esc(s.name)} slab</h1>
<p class="lede">${esc(lede(s))}</p>
<p><a class="cta" href="${esc(app)}">Open the ${esc(s.name)} cross-section in 3D</a></p>
<h2>Catalogue values</h2>
<table>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
${s.ageNote ? `<p class="note">Ages ${esc(s.ageNote)}.</p>` : ''}
<p class="note">Depth errors are those of the table; ages are ranges, not standard deviations. Sinking rate = depth ÷ mean age, assuming vertical sinking (the Atlas's assumption).</p>
<h2>Source</h2>
<pre>${esc(CITE)}</pre>
<nav class="pn">${prev ? `<a href="/slabs/${slug(prev.name)}/">← ${esc(prev.name)} (${n(prev.mid[2])} km)</a>` : '<span></span>'}${next ? `<a href="/slabs/${slug(next.name)}/">${esc(next.name)} (${n(next.mid[2])} km) →</a>` : ''}</nav>`;
  return { path, html: page({ path, title: `${s.name} slab (${s.abbr}): depth, age and sinking rate | Underworld 3D`, description: desc, body, jsonld: [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: `${s.name} slab`, url: SITE + path, description: desc, dateModified: UPDATED,
      about: { '@type': 'Place', name: `${s.name} slab`, geo: { '@type': 'GeoCoordinates', latitude: s.mid[1], longitude: s.mid[0], elevation: -s.mid[2] * 1000 } },
      isBasedOn: 'https://doi.org/10.1016/j.tecto.2017.10.004' },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Underworld 3D', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Slabs', item: `${SITE}/slabs/` },
      { '@type': 'ListItem', position: 3, name: s.name, item: SITE + path }] },
  ] }) };
}

function indexPage() {
  const path = '/slabs/';
  const nActive = slabs.filter(active).length;
  const rows = byDepth.map((s) => `<tr><td><a href="/slabs/${slug(s.name)}/">${esc(s.name)}</a></td><td>${esc(s.abbr)}</td><td>${active(s) ? 'active' : 'detached'}</td><td class="n">${n(s.top[0])}</td><td class="n">${n(s.base[0])}</td><td class="n">${s.ageBase ? n(s.ageBase[1], 0) : '–'}</td><td class="n">${active(s) ? '0' : s.ageTop ? n(s.ageTop[0], 1) : '–'}</td><td class="n">${s.rateBase ? n(s.rateBase[0], 1) : '–'}</td></tr>`).join('\n');
  const desc = `All ${slabs.length} slabs of the Atlas of the Underworld: subducted ocean floor in the mantle, ${nActive} still subducting, with depth, age and sinking rate, and a 3D cross-section for each.`;
  const body = `<p class="crumbs"><a href="/">Underworld 3D</a> › Slabs</p>
<h1>Slabs in the mantle: the catalogue</h1>
<p class="lede">${esc(desc)} Sorted by midpoint depth. Values from van der Meer, van Hinsbergen &amp; Spakman (2018), 2019 table (CC BY 4.0).</p>
<p><a class="cta" href="/">Explore them on the 3D globe</a> · downloads: <a href="/data/slabs.json">slabs.json</a></p>
<div class="wrap"><table><thead><tr><th>Slab</th><th>Abbr.</th><th>Status</th><th class="n">Top km</th><th class="n">Base km</th><th class="n">Onset Ma</th><th class="n">End Ma</th><th class="n">Base rate mm/yr</th></tr></thead><tbody>
${rows}
</tbody></table></div>
<h2>Source</h2><pre>${esc(CITE)}</pre>`;
  return { path, html: page({ path, title: 'Slabs in the mantle: all 100 slabs of the Atlas of the Underworld | Underworld 3D', description: desc, body, jsonld: [
    { '@context': 'https://schema.org', '@type': 'Dataset', name: 'Slab remnants in the mantle (Atlas of the Underworld, 2019 table), as served by Underworld 3D',
      description: `${desc} Positions, top and base depths with errors, onset and end ages of subduction, average sinking rates with errors, and the geological record of each slab.`,
      url: SITE + path, isBasedOn: 'https://doi.org/10.1016/j.tecto.2017.10.004', license: 'https://creativecommons.org/licenses/by/4.0/',
      creator: [{ '@type': 'Person', name: 'Douwe G. van der Meer' }, { '@type': 'Person', name: 'Douwe J. J. van Hinsbergen' }, { '@type': 'Person', name: 'Wim Spakman' }],
      keywords: ['subduction', 'slab', 'mantle', 'seismic tomography', 'plate tectonics', 'sinking rate'], dateModified: UPDATED,
      spatialCoverage: { '@type': 'Place', geo: { '@type': 'GeoShape', box: '-90 -180 90 180' } },
      distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE}/data/slabs.json` }] },
  ] }) };
}

const out = [indexPage(), ...byDepth.map(slabPage)];
if (new Set(out.map((p) => p.path)).size !== out.length) throw new Error('duplicate slab slugs');
rmSync('public/slabs', { recursive: true, force: true });
for (const p of out) { mkdirSync(`public${p.path}`, { recursive: true }); writeFileSync(`public${p.path}index.html`, p.html); }
const urls = ['/', ...out.map((p) => p.path)];
writeFileSync('public/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${UPDATED}</lastmod></url>`).join('\n')}\n</urlset>\n`);
writeFileSync('public/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`${out.length} pages, ${urls.length} sitemap URLs`);
