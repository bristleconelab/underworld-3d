// Perceptually uniform, colour-vision-deficiency-friendly colour maps (matplotlib viridis and plasma, sampled at 11
// stops and linearly interpolated in sRGB, max deviation from the full 256-entry tables about 1%).

type Stops = string[];
export const VIRIDIS: Stops = ['#440154', '#482475', '#414487', '#355f8d', '#2a788e', '#21918c', '#22a884', '#44bf70', '#7ad151', '#bddf26', '#fde725'];
export const PLASMA: Stops = ['#0d0887', '#41049d', '#6a00a8', '#8f0da4', '#b12a90', '#cc4778', '#e16462', '#f2844b', '#fca636', '#fcce25', '#f0f921'];

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const cache = new Map<Stops, [number, number, number][]>();

/** Colour (sRGB 0..1) at t in [0, 1]. */
export function sample(map: Stops, t: number): [number, number, number] {
  let c = cache.get(map); if (!c) cache.set(map, (c = map.map(hex)));
  const f = Math.min(1, Math.max(0, t)) * (c.length - 1), i = Math.min(c.length - 2, Math.floor(f)), k = f - i;
  return [c[i][0] + (c[i + 1][0] - c[i][0]) * k, c[i][1] + (c[i + 1][1] - c[i][1]) * k, c[i][2] + (c[i + 1][2] - c[i][2]) * k];
}
export const css = (map: Stops, t: number) => { const [r, g, b] = sample(map, t); return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`; };
export const gradient = (map: Stops, dir = 'to right') => `linear-gradient(${dir}, ${map.join(', ')})`;

/** Depth colouring used everywhere: quakes plasma over 0-700 km, Slab2 viridis over 0-700 km. */
export const QUAKE_DEPTH_MAX = 700;
export const SLAB2_DEPTH_MAX = 700;
export const quakeColor = (depthKm: number) => sample(PLASMA, depthKm / QUAKE_DEPTH_MAX);
export const slab2Color = (depthKm: number) => sample(VIRIDIS, depthKm / SLAB2_DEPTH_MAX);

/** Atlas slab status, PB2002 boundary classes: categorical colours distinguishable under deuteranopia/protanopia
 *  (Okabe-Ito palette). */
export const OKABE = { orange: '#E69F00', sky: '#56B4E9', green: '#009E73', yellow: '#F0E442', blue: '#0072B2', vermillion: '#D55E00', purple: '#CC79A7', grey: '#999999' };
export const SLAB_STATUS = { active: OKABE.sky, detached: OKABE.orange };
export const BOUNDARY_COLORS: Record<string, string> = {
  SUB: OKABE.vermillion, OCB: OKABE.purple, CCB: OKABE.purple, OSR: OKABE.green, CRB: OKABE.green, OTF: OKABE.yellow, CTF: OKABE.yellow,
};
