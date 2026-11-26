// A vertical cross-section along a great circle: centre point, azimuth of the profile, half-length and the half-width
// of the swath of data projected onto it. The section plane contains the Earth's centre, the centre point and the
// profile direction, so it cuts the sphere along a great circle (not a meridian unless az = 0 or 180).

import { cross, destination, dot, enu, R_KM, toXYZ, unit, type Vec3 } from './geodesy';

export interface Section { lon: number; lat: number; az: number; halfLengthKm: number; halfWidthKm: number }

export interface SectionFrame { centre: Vec3; along: Vec3; normal: Vec3; section: Section }

/** The orthonormal frame of a section: centre (radial unit), along (profile direction at the centre), normal. */
export function sectionFrame(s: Section): SectionFrame {
  const { east, north, up } = enu(s.lon, s.lat);
  const a = (s.az * Math.PI) / 180;
  const along: Vec3 = unit([north[0] * Math.cos(a) + east[0] * Math.sin(a), north[1] * Math.cos(a) + east[1] * Math.sin(a), north[2] * Math.cos(a) + east[2] * Math.sin(a)]);
  return { centre: up, along, normal: unit(cross(up, along)), section: s };
}

export interface Projected { xKm: number; depthKm: number; offKm: number }

/**
 * Project a unit-sphere point (radius 1 - depth/R) onto the section: xKm = arc distance along the profile measured at
 * the surface (positive in the azimuth direction), depthKm = its depth, offKm = signed distance from the plane.
 */
export function project(f: SectionFrame, p: Vec3): Projected {
  const off = dot(p, f.normal);
  const inPlane: Vec3 = [p[0] - off * f.normal[0], p[1] - off * f.normal[1], p[2] - off * f.normal[2]];
  const ang = Math.atan2(dot(inPlane, f.along), dot(inPlane, f.centre));
  const r = Math.hypot(p[0], p[1], p[2]);
  return { xKm: ang * R_KM, depthKm: (1 - r) * R_KM, offKm: off * R_KM };
}

export function projectLonLat(f: SectionFrame, lon: number, lat: number, depthKm: number): Projected {
  return project(f, toXYZ(lon, lat, depthKm));
}

/** Is a projected point inside the swath and within the profile length? */
export const inSwath = (f: SectionFrame, q: Projected) => Math.abs(q.offKm) <= f.section.halfWidthKm && Math.abs(q.xKm) <= f.section.halfLengthKm;

/** End points A (start, at -halfLength) and B (end, at +halfLength) of the profile on the surface. */
export function endpoints(s: Section): { a: [number, number]; b: [number, number] } {
  return { a: destination(s.lon, s.lat, (s.az + 180) % 360, s.halfLengthKm), b: destination(s.lon, s.lat, s.az, s.halfLengthKm) };
}
