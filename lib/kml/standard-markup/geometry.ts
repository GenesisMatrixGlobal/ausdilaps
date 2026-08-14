// Small, self-contained planar-geometry helpers for the Standard Mark Up tool.
// No turf/GIS library in this repo — the same flat-earth approach is already
// hand-rolled in lib/property-sizing/site-plan/georeference.ts; this is the
// equivalent for standard-markup rather than coupling to that (unrelated) subsystem.

import type { LatLng } from "@/lib/kml/types";

const METRES_PER_DEG_LAT = 111320; // good enough at parcel/street scale

function metresPerDegLng(atLat: number): number {
  return METRES_PER_DEG_LAT * Math.cos((atLat * Math.PI) / 180);
}

export interface LocalMetres {
  east: number;
  north: number;
}

/** Flat-earth local projection around `origin` — accurate to well under a metre at this scale. */
export function projectToLocalMetres(origin: LatLng, point: LatLng): LocalMetres {
  return {
    east: (point.lng - origin.lng) * metresPerDegLng(origin.lat),
    north: (point.lat - origin.lat) * METRES_PER_DEG_LAT,
  };
}

export function unprojectFromLocalMetres(origin: LatLng, offset: LocalMetres): LatLng {
  return {
    lat: origin.lat + offset.north / METRES_PER_DEG_LAT,
    lng: origin.lng + offset.east / metresPerDegLng(origin.lat),
  };
}

export interface Envelope {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

/** A small envelope (in lon/lat, ArcGIS `xmin,ymin,xmax,ymax` order) around a point, `halfWidthM` each way. */
export function envelopeAroundPoint(lng: number, lat: number, halfWidthM: number): Envelope {
  const latPad = halfWidthM / METRES_PER_DEG_LAT;
  const lngPad = halfWidthM / metresPerDegLng(lat);
  return { xmin: lng - lngPad, ymin: lat - latPad, xmax: lng + lngPad, ymax: lat + latPad };
}

/** Appends the first point to close the ring, unless it's already closed. */
export function closeRing(ring: LatLng[]): LatLng[] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first.lat === last.lat && first.lng === last.lng ? ring : [...ring, first];
}

/** Ray-casting point-in-polygon (lat/lng treated as planar — fine at parcel scale). */
export function pointInRing(point: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i];
    const pj = ring[j];
    const intersect =
      pi.lat > point.lat !== pj.lat > point.lat &&
      point.lng < ((pj.lng - pi.lng) * (point.lat - pi.lat)) / (pj.lat - pi.lat) + pi.lng;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointToSegmentMetres(p: LocalMetres, a: LocalMetres, b: LocalMetres): number {
  const dx = b.east - a.east;
  const dy = b.north - a.north;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.east - a.east, p.north - a.north);
  let t = ((p.east - a.east) * dx + (p.north - a.north) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.east - (a.east + t * dx), p.north - (a.north + t * dy));
}

function segmentToSegmentMetres(a1: LocalMetres, a2: LocalMetres, b1: LocalMetres, b2: LocalMetres): number {
  return Math.min(
    pointToSegmentMetres(a1, b1, b2),
    pointToSegmentMetres(a2, b1, b2),
    pointToSegmentMetres(b1, a1, a2),
    pointToSegmentMetres(b2, a1, a2)
  );
}

/**
 * Minimum distance in metres between two polylines. Pass a closed ring (see `closeRing`)
 * for a polygon boundary, or an open way for a road/footpath centerline.
 */
export function minDistanceBetween(a: LatLng[], b: LatLng[]): number {
  if (a.length < 2 || b.length < 2) return Infinity;
  const origin = a[0];
  const aM = a.map((p) => projectToLocalMetres(origin, p));
  const bM = b.map((p) => projectToLocalMetres(origin, p));
  let min = Infinity;
  for (let i = 0; i < aM.length - 1; i++) {
    for (let j = 0; j < bM.length - 1; j++) {
      min = Math.min(min, segmentToSegmentMetres(aM[i], aM[i + 1], bM[j], bM[j + 1]));
    }
  }
  return min;
}

function segmentNormal(a: LocalMetres, b: LocalMetres): LocalMetres {
  const dx = b.east - a.east;
  const dy = b.north - a.north;
  const len = Math.hypot(dx, dy) || 1;
  return { east: -dy / len, north: dx / len };
}

/**
 * Buffers a user-drawn polyline (2-10 points, e.g. a council-asset frontage) into a
 * ribbon polygon `widthMetres` wide. Each point is offset perpendicular to its
 * segment(s) — the two ends use their single segment's normal, interior points use the
 * average of their two adjacent segment normals (a simple mitre join). That average
 * isn't length-corrected for the joint angle, so a sharp bend renders very slightly
 * narrower right at the corner — an acceptable simplification for an indicative site
 * marking, not worth full mitre/bevel join geometry.
 */
export function bufferLineToPolygon(points: LatLng[], widthMetres: number): LatLng[] {
  if (points.length < 2) return [];
  const origin = points[0];
  const local = points.map((p) => projectToLocalMetres(origin, p));
  const halfWidth = widthMetres / 2;

  const segmentNormals: LocalMetres[] = [];
  for (let i = 0; i < local.length - 1; i++) {
    segmentNormals.push(segmentNormal(local[i], local[i + 1]));
  }

  function pointNormal(i: number): LocalMetres {
    if (i === 0) return segmentNormals[0];
    if (i === local.length - 1) return segmentNormals[segmentNormals.length - 1];
    const n1 = segmentNormals[i - 1];
    const n2 = segmentNormals[i];
    const avg = { east: n1.east + n2.east, north: n1.north + n2.north };
    const len = Math.hypot(avg.east, avg.north) || 1;
    return { east: avg.east / len, north: avg.north / len };
  }

  const left: LocalMetres[] = [];
  const right: LocalMetres[] = [];
  for (let i = 0; i < local.length; i++) {
    const n = pointNormal(i);
    left.push({ east: local[i].east + n.east * halfWidth, north: local[i].north + n.north * halfWidth });
    right.push({ east: local[i].east - n.east * halfWidth, north: local[i].north - n.north * halfWidth });
  }

  const ring = [...left, ...right.reverse()].map((p) => unprojectFromLocalMetres(origin, p));
  return closeRing(ring);
}

/** Douglas-Peucker simplification, tolerance in metres — trims redundant near-collinear
 *  survey vertices (common in DCDB parcel rings) before encoding into a Static Maps URL. */
export function simplifyRing(ring: LatLng[], toleranceMetres: number): LatLng[] {
  if (ring.length <= 3) return ring;
  const origin = ring[0];
  const points = ring.map((p) => projectToLocalMetres(origin, p));
  const keep = new Set<number>([0, points.length - 1]);

  function recurse(start: number, end: number) {
    if (end <= start + 1) return;
    let maxDist = -1;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const d = pointToSegmentMetres(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIndex = i;
      }
    }
    if (maxDist > toleranceMetres) {
      keep.add(maxIndex);
      recurse(start, maxIndex);
      recurse(maxIndex, end);
    }
  }
  recurse(0, points.length - 1);

  return Array.from(keep)
    .sort((a, b) => a - b)
    .map((i) => ring[i]);
}
