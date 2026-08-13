// Works out which road(s) the subject parcel fronts, whether it's a corner block,
// and how far the "council asset" (road + footpath) highlight should extend:
// 1 neighbouring property either side on a normal block, or the intersection plus
// a bit of each road on a corner.
//
// Simplification (deliberate, KISS): rendered segments are straight lines between
// computed extent points, not snapped/clipped to the road's exact curve — at the
// ~1-3 lot-width scale this highlights, the visual difference from the real curve
// is negligible for the vast majority of suburban streets.

import type { LatLng } from "@/lib/kml/types";
import { nameMatches, type OsmWay, type RoadNetworkNear } from "@/lib/kml/road-segments/overpass";
import {
  closeApproachRun,
  closestApproachPoint,
  minDistanceBetween,
  projectOntoAxis,
  unitBearingVector,
  unprojectFromLocalMetres,
  type LocalMetres,
} from "./geometry";
import type { ParcelFeature } from "./parcels/types";

const FRONTING_DIST_M = 15; // road-centerline-to-title-boundary offset (verge + footpath + nature strip)
const FRONTING_RUN_M = 8; // minimum contact run — excludes a battle-axe lot merely clipping a road at one corner
const FOOTPATH_ATTACH_DIST_M = 15;
const FOOTPATH_OFFSET_M = 3.5; // fallback verge-position approximation when no footway is mapped
const CORNER_DEFAULT_EXTENT_M = 25; // fallback when the subject's own frontage width can't be measured
const INTERSECTION_PAD_M = 10; // small extension past the corner on the "away" side, so the intersection itself reads as covered
const SPAN_TOLERANCE_M = 1; // slack when deciding whether a neighbour sits "immediately outside" the subject's span

export interface FrontageResult {
  isCorner: boolean;
  /** Polylines to render in the fixed "council asset" colour — road + footpath segments. */
  assets: LatLng[][];
  flags: string[];
}

function centroidOf(ring: LatLng[]): LatLng {
  const lat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
  const lng = ring.reduce((s, p) => s + p.lng, 0) / ring.length;
  return { lat, lng };
}

function spanAlongAxis(origin: LatLng, axis: LocalMetres, points: LatLng[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const v = projectOntoAxis(origin, axis, p);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

function pointAt(origin: LatLng, axis: LocalMetres, distance: number): LatLng {
  return unprojectFromLocalMetres(origin, { east: axis.east * distance, north: axis.north * distance });
}

interface FrontingWay {
  way: OsmWay;
  minDistance: number;
}

/** Groups ways whose names are spelling variants of each other (a real road is often
 *  split into several OSM way segments) — unnamed ways group together as one bucket. */
function groupByName(ways: FrontingWay[]): FrontingWay[][] {
  const groups: FrontingWay[][] = [];
  for (const fw of ways) {
    const group = groups.find((g) => {
      const rep = g[0].way.name;
      return rep === fw.way.name || (!!rep && !!fw.way.name && nameMatches(fw.way.name, rep));
    });
    if (group) group.push(fw);
    else groups.push([fw]);
  }
  return groups;
}

function averageDistance(group: FrontingWay[]): number {
  return group.reduce((s, f) => s + f.minDistance, 0) / group.length;
}

function closestWayIn(group: FrontingWay[]): OsmWay {
  return group.reduce((best, f) => (f.minDistance < best.minDistance ? f : best)).way;
}

/** Clips a footway to the given axis range if it actually runs alongside the road there;
 *  otherwise approximates the verge position by offsetting the road line itself. */
function footpathSegment(
  roadPoints: LatLng[],
  origin: LatLng,
  axis: LocalMetres,
  min: number,
  max: number,
  footways: OsmWay[],
  flags: string[]
): LatLng[] {
  const nearby = footways.filter((fw) => minDistanceBetween(roadPoints, fw.nodes) <= FOOTPATH_ATTACH_DIST_M);
  for (const fw of nearby) {
    const withinRange = fw.nodes.filter((p) => {
      const v = projectOntoAxis(origin, axis, p);
      return v >= min - 5 && v <= max + 5;
    });
    if (withinRange.length >= 2) return withinRange;
  }
  flags.push("no mapped footpath found for this frontage — verge position approximated, verify on site");
  const perp: LocalMetres = { east: -axis.north, north: axis.east };
  return roadPoints.map((p) => unprojectFromLocalMetres(p, { east: perp.east * FOOTPATH_OFFSET_M, north: perp.north * FOOTPATH_OFFSET_M }));
}

export function computeFrontage(
  subject: ParcelFeature,
  neighbours: ParcelFeature[],
  roadName: string,
  network: RoadNetworkNear
): FrontageResult {
  const flags: string[] = [];
  const subjectCentroid = centroidOf(subject.ring);

  const fronting: FrontingWay[] = network.road
    .map((way) => ({ way, ...closeApproachRun(way.nodes, subject.ring, FRONTING_DIST_M) }))
    .filter((f) => f.runLengthMetres >= FRONTING_RUN_M)
    .map((f) => ({ way: f.way, minDistance: f.minDistance }));

  if (fronting.length === 0) {
    return { isCorner: false, assets: [], flags: ["couldn't identify a fronting road from OSM data — check the address/road name"] };
  }

  const groups = groupByName(fronting);
  let primaryGroup = groups.find((g) => g.some((f) => f.way.name && nameMatches(f.way.name, roadName)));
  if (!primaryGroup) {
    primaryGroup = groups.reduce((best, g) => (averageDistance(g) < averageDistance(best) ? g : best));
    flags.push(`couldn't confirm the fronting road matches "${roadName}" — used the closest mapped road instead, verify on site`);
  }
  const otherGroups = groups.filter((g) => g !== primaryGroup);
  const crossGroup = otherGroups.length > 0 ? otherGroups.reduce((best, g) => (averageDistance(g) < averageDistance(best) ? g : best)) : null;

  const frontageWay = closestWayIn(primaryGroup);
  const axis = unitBearingVector(frontageWay.nodes[0], frontageWay.nodes[frontageWay.nodes.length - 1]);
  const subjectSpan = spanAlongAxis(subjectCentroid, axis, subject.ring);
  const frontageWidth = subjectSpan.max - subjectSpan.min;

  if (crossGroup) {
    // Corner block: cover the intersection + a bit of each road, extended toward the subject.
    const crossWay = closestWayIn(crossGroup);
    const intersection = closestApproachPoint(frontageWay.nodes, crossWay.nodes);

    function extendFromIntersection(way: OsmWay, extentM: number): LatLng[] {
      const wayAxis = unitBearingVector(way.nodes[0], way.nodes[way.nodes.length - 1]);
      const towardSubject = projectOntoAxis(intersection, wayAxis, subjectCentroid);
      const sign = towardSubject >= 0 ? 1 : -1;
      const far = pointAt(intersection, wayAxis, sign * extentM);
      const near = pointAt(intersection, wayAxis, -sign * INTERSECTION_PAD_M);
      return [near, far];
    }

    const crossAxis = unitBearingVector(crossWay.nodes[0], crossWay.nodes[crossWay.nodes.length - 1]);
    const crossSpan = spanAlongAxis(subjectCentroid, crossAxis, subject.ring);
    const crossWidth = crossSpan.max - crossSpan.min;

    const primaryExtent = frontageWidth > 0 ? frontageWidth : CORNER_DEFAULT_EXTENT_M;
    const crossExtent = crossWidth > 0 ? crossWidth : CORNER_DEFAULT_EXTENT_M;
    if (frontageWidth <= 0 || crossWidth <= 0) {
      flags.push("couldn't measure the parcel's frontage width on one road — used a default 25m extent, verify on site");
    }

    const primaryRoadPoints = extendFromIntersection(frontageWay, primaryExtent);
    const crossRoadPoints = extendFromIntersection(crossWay, crossExtent);

    const assets: LatLng[][] = [primaryRoadPoints, crossRoadPoints];
    assets.push(footpathSegment(primaryRoadPoints, intersection, axis, -primaryExtent - INTERSECTION_PAD_M, primaryExtent, network.footway, flags));
    assets.push(footpathSegment(crossRoadPoints, intersection, crossAxis, -crossExtent - INTERSECTION_PAD_M, crossExtent, network.footway, flags));

    return { isCorner: true, assets, flags };
  }

  // Non-corner: extend the subject's own frontage to include one neighbour either side.
  const neighbourSpans = neighbours.map((n) => ({ n, span: spanAlongAxis(subjectCentroid, axis, n.ring) }));
  const left = neighbourSpans
    .filter((s) => s.span.max <= subjectSpan.min + SPAN_TOLERANCE_M)
    .reduce<{ span: { min: number; max: number } } | null>((best, s) => (!best || s.span.max > best.span.max ? s : best), null);
  const right = neighbourSpans
    .filter((s) => s.span.min >= subjectSpan.max - SPAN_TOLERANCE_M)
    .reduce<{ span: { min: number; max: number } } | null>((best, s) => (!best || s.span.min < best.span.min ? s : best), null);

  if (!left) flags.push("no neighbour found on one side — extended by the subject's own frontage width as a default, verify on site");
  if (!right) flags.push("no neighbour found on the other side — extended by the subject's own frontage width as a default, verify on site");

  const extentMin = left ? left.span.min : subjectSpan.min - frontageWidth;
  const extentMax = right ? right.span.max : subjectSpan.max + frontageWidth;

  const roadPoints = [pointAt(subjectCentroid, axis, extentMin), pointAt(subjectCentroid, axis, extentMax)];
  const assets: LatLng[][] = [roadPoints];
  assets.push(footpathSegment(roadPoints, subjectCentroid, axis, extentMin, extentMax, network.footway, flags));

  return { isCorner: false, assets, flags };
}
