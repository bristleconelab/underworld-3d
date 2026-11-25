// Regenerate docs/img/*.png and public/og-image.png from a running dev server (needs Google Chrome; WebGL on the GPU).
// usage: npx vite --port 5299 (another terminal), then node scripts/screenshots.mjs [baseUrl]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5299/';
mkdirSync('docs/img', { recursive: true });
const shots = [
  { file: 'docs/img/globe.png', hash: '', size: [1440, 900], js: 'window.__uw.globe.controls.autoRotate=false; window.__uw.globe.flyTowards(150, 5, 2.7)' },
  { file: 'docs/img/tonga.png', hash: '#slab=TKH', size: [1440, 900] },
  { file: 'docs/img/india.png', hash: '#slab=In', size: [1440, 900] },
  { file: 'docs/img/time.png', hash: '', size: [1440, 900], js: "window.__uw.globe.controls.autoRotate=false; window.__uw.globe.flyTowards(60, 20, 2.9); const t=document.querySelector('#time'); t.value='150'; t.dispatchEvent(new Event('input'))" },
  { file: 'docs/img/phone.png', hash: '#slab=Mr', size: [390, 844], mobile: true },
  { file: 'public/og-image.png', hash: '#slab=TKH', size: [1200, 630] },
];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.size[0], height: s.size[1] }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: !!s.mobile, hasTouch: !!s.mobile });
  const page = await ctx.newPage();
  await page.goto(base + s.hash, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  if (s.js) await page.evaluate(s.js);
  await page.waitForTimeout(3500); // camera flight (1.6 s) and textures
  await page.screenshot({ path: s.file });
  console.log(s.file);
  await ctx.close();
}
await browser.close();
