import type { LatLng } from "@/lib/kml/types";
import { bufferLineToPolygon, closeRing, pathLengthMetres, pointInRing, ringAreaSqm } from "./geometry";

/**
 * The pure measurement layer, shared by the Residential Mark Up tab (which measures shapes
 * it will bake into an exported PNG) and the Measure tab (which measures shapes on a live
 * Google map).
 *
 * It lives here, once, rather than in either tab. style.ts exists in this same folder
 * because the client overlay and the server renderer each kept their own copy of the same
 * constants and drifted; two copies of the AREA maths would be the same mistake with worse
 * consequences — two tools quoting different square metres for the same outline.
 */

export type ShapeMode = "line" | "area";

/** A line needs two points to have a direction to buffer perpendicular to; an area needs
 *  three to enclose anything. Below that a shape measures as nothing and renders as
 *  nothing. */
export const MIN_POINTS: Record<ShapeMode, number> = { line: 2, area: 3 };

/** The minimum a shape needs to be measurable.
 *
 *  Deliberately not `Omit<MarkupShape, "color">`: the Measure tab has no colour axis at
 *  all, and coupling it to the shape of the Residential tab's wire format would break it
 *  the moment MarkupShape gains a field. Both satisfy this structurally, so neither side
 *  has to know the other exists. */
export interface Measurable {
  points: LatLng[];
  widthMetres: number;
  mode: ShapeMode;
}

export interface ShapeMeasurement {
  /** Ground area the shape covers. For a line that's the ribbon, not the centreline. */
  areaSqm: number;
  /** Centreline length — lines only; an area has no meaningful single length. */
  lengthMetres: number | null;
}

/** Measures a shape off the SAME ring the renderer draws, so the number always describes
 *  the thing on screen — mitred corners and all — rather than an idealised width x length. */
export function measureShape(shape: Measurable): ShapeMeasurement {
  if (shape.points.length < MIN_POINTS[shape.mode]) return { areaSqm: 0, lengthMetres: null };
  if (shape.mode === "area") {
    return { areaSqm: ringAreaSqm(closeRing(shape.points)), lengthMetres: null };
  }
  return {
    areaSqm: ringAreaSqm(bufferLineToPolygon(shape.points, shape.widthMetres)),
    lengthMetres: pathLengthMetres(shape.points),
  };
}

/** The ring a shape's area is actually computed from — an area's own closed boundary, or a
 *  line's buffered ribbon. Callers that need to DRAW that ring (the Measure tab's derived
 *  ribbon polygon, and its centroid label) go through this so they can't diverge from what
 *  measureShape() just measured. */
export function ringFor(shape: Measurable): LatLng[] {
  if (shape.points.length < MIN_POINTS[shape.mode]) return [];
  return shape.mode === "area"
    ? closeRing(shape.points)
    : bufferLineToPolygon(shape.points, shape.widthMetres);
}

/** Always square metres, at every magnitude.
 *
 *  This used to switch to hectares past 10,000 m² on the theory that "1.24 ha" is easier
 *  to picture than "12,400 m²". It isn't, for the people using this: m² is the unit
 *  estimating and pricing are done in, so a hectare figure has to be converted back by
 *  hand before it's useful. Thousands separators carry the magnitude well enough.
 *
 *  Shared by the Residential Mark Up sidebar and the Measure tab, so both read the same
 *  way for the same outline. Nothing server-side formats area — the exported PNG's legend
 *  doesn't use this — so changing it moves no client-facing number. */
export function formatArea(areaSqm: number): string {
  return `${Math.round(areaSqm).toLocaleString()} m²`;
}

export function formatLength(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;
}

/**
 * True when the outline crosses itself.
 *
 * ringAreaSqm is a signed spherical-excess sum wrapped in Math.abs. Drag one vertex across
 * an opposite edge into a bowtie and Google renders it happily while the sum reports the
 * DIFFERENCE of the two lobes — which for a symmetrical bowtie is near zero. That is a
 * wrong number presented with full confidence, which in a measuring tool is worse than no
 * number, so the panel replaces the figure with a warning instead.
 *
 * Brute force over every non-adjacent segment pair. O(n^2) on a ring capped at ~100 points
 * is microseconds, and it runs in plain planar metres because self-intersection is a
 * topological question — curvature can't create or remove a crossing at parcel scale.
 */
export function ringSelfIntersects(ring: LatLng[]): boolean {
  const r = closeRing(ring);
  // closeRing repeats the first point, so the segment count is r.length - 1.
  const n = r.length - 1;
  if (n < 4) return false; // a triangle cannot cross itself

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent pairs, and the first-vs-last pair, which share an endpoint by
      // construction and would always "intersect" there.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(r[i], r[i + 1], r[j], r[j + 1])) return true;
    }
  }
  return false;
}

function cross(o: LatLng, a: LatLng, b: LatLng): number {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
}

/** Strict proper crossing — the two segments pass through each other. Touching endpoints
 *  and collinear overlap return false: a vertex dropped exactly onto another edge is a
 *  degenerate outline, not a bowtie, and flagging it would fire on shapes that measure
 *  correctly. */
function segmentsCross(p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/**
 * Where a numbered badge belongs for a bare ring (a cadastre lot, or an area shape).
 *
 * NOT the vertex-average centroid, which is what this used to be. That average sits outside
 * any concave outline — an L-shaped lot puts it in the notch — so the pin ended up floating
 * over the neighbour instead of the thing it names.
 *
 * Tries the true area centroid, then, if that is outside, walks in from it towards each vertex
 * and takes the first point that is genuinely inside. Cheap (rings here are tens of vertices at
 * most) and it lands near the middle rather than on an edge.
 */
export function ringAnchor(ring: LatLng[]): LatLng | null {
  if (ring.length < 3) return null;
  const closed = closeRing(ring);
  // Standard area-weighted polygon centroid (the shoelace), computed RELATIVE TO ring[0].
  //
  // The offset is not tidiness, it is required. Run raw, the cross products are ~144.877 x
  // -37.84 = -5482 while the signal in them is ~1e-9, so double precision cancels almost all of
  // it away and the answer is noise. Verified: two ordinary rectangular Newport lots reported a
  // centroid outside themselves until the coordinates were localised.
  const ox = closed[0].lng;
  const oy = closed[0].lat;
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < closed.length - 1; i++) {
    const ax = closed[i].lng - ox;
    const ay = closed[i].lat - oy;
    const bx = closed[i + 1].lng - ox;
    const by = closed[i + 1].lat - oy;
    const cross = ax * by - bx * ay;
    twiceArea += cross;
    cx += (ax + bx) * cross;
    cy += (ay + by) * cross;
  }
  // A degenerate ring (every point collinear) has no centroid to speak of.
  const centroid =
    Math.abs(twiceArea) < 1e-18
      ? { lat: oy, lng: ox }
      : { lat: oy + cy / (3 * twiceArea), lng: ox + cx / (3 * twiceArea) };

  if (pointInRing(centroid, ring)) return centroid;
  for (const v of ring) {
    const mid = { lat: (centroid.lat + v.lat) / 2, lng: (centroid.lng + v.lng) / 2 };
    if (pointInRing(mid, ring)) return mid;
  }
  return centroid;
}

/**
 * Where a numbered badge belongs for a shape.
 *
 * A LINE's badge goes on its CENTRELINE, at the half-way point by length — which is inside the
 * buffered ribbon by construction, because the ribbon is centred on that line. Using the
 * ribbon's centroid instead put the badge off the shape entirely on any bend: an L-shaped road
 * frontage at Newport landed its pin on the neighbouring lot, because the centroid of an L sits
 * in the notch.
 */
export function badgeAnchor(shape: Measurable): LatLng | null {
  if (shape.points.length < MIN_POINTS[shape.mode]) return null;
  if (shape.mode === "area") return ringAnchor(closeRing(shape.points));

  const total = pathLengthMetres(shape.points);
  if (total === 0) return shape.points[0];
  let walked = 0;
  for (let i = 0; i < shape.points.length - 1; i++) {
    const a = shape.points[i];
    const b = shape.points[i + 1];
    const seg = pathLengthMetres([a, b]);
    if (walked + seg >= total / 2) {
      const t = seg === 0 ? 0 : (total / 2 - walked) / seg;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    walked += seg;
  }
  return shape.points[shape.points.length - 1];
}
