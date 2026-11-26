// Tiny DOM helpers and the context object the UI modules share.

import type { Store } from '../core/store';
import type { Data } from '../data/load';
import type { Globe } from '../render3d/globe';

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (k === 'class') e.className = v; else e.setAttribute(k, v);
  for (const k of kids) if (k != null && k !== false) e.append(k);
  return e;
}

export interface Ctx {
  store: Store;
  globe: Globe;
  data: Data;
  /** Selected earthquake index (-1 none) and Slab2 pick, kept outside the URL state. */
  sel: { quake: number };
  toast(msg: string): void;
  inspectSlab(abbr: string | null): void;
  inspectQuake(i: number): void;
  inspectPlate(hit: { zone: string; depthKm: number; dip: number; dipAz: number; lon: number; lat: number }): void;
  refreshAnalysis(): void;
}

export function toast(msg: string) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout((t as unknown as { _t: number })._t);
  (t as unknown as { _t: number })._t = window.setTimeout(() => (t.hidden = true), 2600);
}

/** Generic dialog wiring: close button, click on backdrop. */
export function wireDialog(d: HTMLDialogElement) {
  d.querySelector('.close')?.addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}
