// The crawlable pages are generated from the data files (scripts/seo_pages.mjs): check they exist and agree with them.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const slabs = JSON.parse(readFileSync('public/data/slabs.json', 'utf8')).slabs as { name: string; abbr: string; base: [number, number] }[];
const slug = (name: string) => name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

describe('SEO pages', () => {
  const sitemap = readFileSync('public/sitemap.xml', 'utf8');
  it('lists the home page, the catalogue and every slab page in the sitemap', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toHaveLength(slabs.length + 2);
    expect(locs[0]).toBe('https://underworld.bristleconelab.org/');
    expect(new Set(locs).size).toBe(locs.length);
  });
  it('has a page per slab carrying its catalogue values and a link into the 3D view', () => {
    for (const s of slabs) {
      const p = `public/slabs/${slug(s.name)}/index.html`;
      expect(existsSync(p), p).toBe(true);
      const html = readFileSync(p, 'utf8');
      expect(html).toContain(`#slab=${encodeURIComponent(s.abbr)}&amp;tab=section`);
      expect(html).toContain(`${s.base[0].toLocaleString('en-US')} ± ${s.base[1].toLocaleString('en-US')} km`);
      expect(html).toContain(`<link rel="canonical" href="https://underworld.bristleconelab.org/slabs/${slug(s.name)}/">`);
      expect(html).not.toMatch(/9999|NaN|undefined/);
    }
  });
  it('robots.txt points at the sitemap and the IndexNow key file matches the script', () => {
    expect(readFileSync('public/robots.txt', 'utf8')).toContain('Sitemap: https://underworld.bristleconelab.org/sitemap.xml');
    const key = /KEY=([0-9a-f]{32})/.exec(readFileSync('scripts/indexnow.sh', 'utf8'))![1];
    expect(readFileSync(`public/${key}.txt`, 'utf8')).toBe(key);
  });
});
