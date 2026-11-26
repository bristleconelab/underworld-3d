// Regenerate docs/img/*.png and public/og-image.png from a running dev server (needs Google Chrome; WebGL on the GPU).
// usage: npx vite --port 5299 (another terminal), then node scripts/screenshots.mjs [baseUrl]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5299/';
mkdirSync('docs/img', { recursive: true });
const shots = [
  { file: 'docs/img/globe.png', hash: '#cam=-1.722,0.420,-2.469,0,0,0', size: [1440, 900] },
  { file: 'docs/img/tonga.png', hash: '#slab=TKH&tab=section', size: [1440, 900] },
  { file: 'docs/img/depth-age.png', hash: '#slab=In&tab=depthage', size: [1440, 900] },
  { file: 'docs/img/seismicity.png', hash: '#slab=Mr&tab=seismicity', size: [1440, 900] },
  { file: 'docs/img/time.png', hash: '#t=150&tm=advect&cam=2.537,1.081,1.236,0,0,0', size: [1440, 900] },
  { file: 'docs/img/light.png', hash: '#slab=Co&tab=section&th=light', size: [1440, 900] },
  { file: 'docs/img/phone.png', hash: '#slab=Mr', size: [390, 844], mobile: true },
  { file: 'public/og-image.png', hash: '#slab=TKH&tab=section', size: [1200, 630] },
];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.size[0], height: s.size[1] }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: !!s.mobile, hasTouch: !!s.mobile });
  const page = await ctx.newPage();
  await page.goto(base + s.hash, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2600); // camera flight (1.4 s) and textures
  await page.screenshot({ path: s.file });
  console.log(s.file);
  await ctx.close();
}
await browser.close();
