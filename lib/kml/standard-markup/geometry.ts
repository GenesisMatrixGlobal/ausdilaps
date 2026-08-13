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

function distancePointToRing(p: LocalMetres, ringM: LocalMetres[]): number {
  let min = Infinity;
  for (let i = 0; i < ringM.length - 1; i++) {
    min = Math.min(min, pointToSegmentMetres(p, ringM[i], ringM[i + 1]));
  }
  return min;
}

export interface CloseApproach {
  /** Closest distance, in metres, `way` ever comes to `ring`'s boundary. */
  minDistance: number;
  /** Length, in metres, of the longest contiguous stretch of `way` within `thresholdM` of `ring`. */
  runLengthMetres: number;
}

/** How closely and for how long a road/footpath way runs alongside a parcel ring. */
export function closeApproachRun(way: LatLng[], ring: LatLng[], thresholdM: number): CloseApproach {
  if (way.length === 0 || ring.length < 2) return { minDistance: Infinity, runLengthMetres: 0 };
  const origin = way[0];
  const wayM = way.map((p) => projectToLocalMetres(origin, p));
  const ringM = closeRing(ring).map((p) => projectToLocalMetres(origin, p));
  const dists = wayM.map((p) => distancePointToRing(p, ringM));

  let bestRun = 0;
  let currentRun = 0;
  for (let i = 0; i < wayM.length; i++) {
    if (dists[i] <= thresholdM) {
      if (i > 0 && dists[i - 1] <= thresholdM) {
        currentRun += Math.hypot(wayM[i].east - wayM[i - 1].east, wayM[i].north - wayM[i - 1].north);
      }
      bestRun = Math.max(bestRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  return { minDistance: Math.min(...dists), runLengthMetres: bestRun };
}

/** Approximates where two open polylines cross/meet most closely — used to find a
 *  road intersection from two OSM ways. Picks whichever of the four segment
 *  endpoints in the closest-approaching pair sits nearest the other way — exact
 *  when the ways share a node at the junction (the common case for real OSM data). */
export function closestApproachPoint(a: LatLng[], b: LatLng[]): LatLng {
  if (a.length < 2 || b.length < 2) return a[0] ?? b[0];
  const origin = a[0];
  const aM = a.map((p) => projectToLocalMetres(origin, p));
  const bM = b.map((p) => projectToLocalMetres(origin, p));
  let min = Infinity;
  let best = aM[0];
  for (let i = 0; i < aM.length - 1; i++) {
    for (let j = 0; j < bM.length - 1; j++) {
      for (const c of [aM[i], aM[i + 1], bM[j], bM[j + 1]]) {
        const d = Math.min(pointToSegmentMetres(c, aM[i], aM[i + 1]), pointToSegmentMetres(c, bM[j], bM[j + 1]));
        if (d < min) {
          min = d;
          best = c;
        }
      }
    }
  }
  return unprojectFromLocalMetres(origin, best);
}

/** Unit vector (in local east/north metres) pointing from `a` to `b`. */
export function unitBearingVector(a: LatLng, b: LatLng): LocalMetres {
  const m = projectToLocalMetres(a, b);
  const len = Math.hypot(m.east, m.north) || 1;
  return { east: m.east / len, north: m.north / len };
}

/** Signed distance of `point` along `axis` (a unit vector), measured from `origin`. */
export function projectOntoAxis(origin: LatLng, axis: LocalMetres, point: LatLng): number {
  const m = projectToLocalMetres(origin, point);
  return m.east * axis.east + m.north * axis.north;
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
