// Resolves "road name, from cross-street, to cross-street, suburb" into the real
// road centerline between those two intersections. Delegates entirely to the same
// tracer the "Road segments" tab uses (trace.ts — Google when GOOGLE_MAPS_API_KEY is
// configured, else free OSM): Google handles cases OSM's topology doesn't (a
// live-tested example being a stretch where OSM's own way graph for the named road
// wasn't fully connected between two real intersections, even though both individual
// intersections were found correctly — see trace-google.ts's comments for more).

import type { LatLng } from "@/lib/kml/types";
import type { RoadSegmentInput, RoadTraceStatus } from "@/lib/kml/road-segments/types";
import { traceRoadSegments } from "@/lib/kml/road-segments/trace";
import {
  findRoadFollowingRoute,
  routeThroughWaypoints,
  type RoadLeg,
} from "@/lib/kml/road-segments/google-directions";
import { haversineKm } from "@/lib/kml/road-segments/geo";

export interface ResolveRoadResult {
  status: RoadTraceStatus;
  /** The traced centerline between the two cross streets. Empty unless status is "ok". */
  path: LatLng[];
  flags: string[];
  /** Ordered roads the trace travels, with per-road distance. Empty unless status is "ok". */
  roads: RoadLeg[];
}

export async function resolveRoad(
  roadName: string,
  fromDesc: string,
  toDesc: string,
  area: string
): Promise<ResolveRoadResult> {
  // area already carries its own state/postcode (e.g. "Newport, VIC 3015") — override the
  // shared tracer's QLD-council default so Google geocodes against the right state.
  const segment: RoadSegmentInput = { location: area, roadName, fromDesc, toDesc, regionHint: "Australia" };
  const [result] = await traceRoadSegments([segment]);
  return {
    status: result.status,
    path: result.coordinates ?? [],
    flags: result.flags,
    // Present when the Google tracer ran; the free OSM fallback can't produce it. Usually
    // just the named road, but two or more entries means the trace left it — worth showing.
    roads: result.roads ?? [],
  };
}

/** Two endpoints closer together than this can't produce a meaningful road markup, and
 *  Directions will happily return a zero-length route for them. */
const MIN_SEPARATION_KM = 0.005;

/**
 * Coordinate-mode resolver: routes directly between two known points, skipping the
 * geocoding that cross-street mode needs. Goes through Google Directions rather than
 * joining the points with a straight line, because a straight line cuts the corner on
 * every curve and these images end up in inspection reports.
 *
 * If Directions can't find a road route between the points this returns `route_failed`
 * — deliberately no straight-line fallback, so a markup that doesn't follow the road can
 * never reach a report unnoticed.
 */
export async function resolveRoadFromCoords(
  from: LatLng,
  to: LatLng,
  roadName?: string
): Promise<ResolveRoadResult> {
  if (haversineKm(from, to) < MIN_SEPARATION_KM) {
    return {
      status: "route_failed",
      path: [],
      flags: ["the from and to coordinates are the same point"],
      roads: [],
    };
  }

  const route = await findRoadFollowingRoute(from, to, roadName);
  if (!route || route.polyline.length < 2) {
    return { status: "route_failed", path: [], flags: [], roads: [] };
  }

  // Only meaningful when a name was given — without one there is nothing to verify.
  const flags = roadName && !route.followsRoad
    ? [`couldn't confirm this route follows ${roadName} — verify manually`]
    : [];

  return { status: "ok", path: route.polyline, flags, roads: route.roads };
}

export interface ResolveRouteResult extends ResolveRoadResult {
  /** Google's road distance for the route, in km. 0 unless status is "ok". */
  distanceKm: number;
}

/**
 * Route-mode resolver: traces the road-following path through an ordered list of waypoints
 * lifted from a pasted Google Maps directions URL.
 *
 * Like coordinate mode, a route Google can't trace is an error rather than a straight line
 * — a markup that doesn't follow the road must never reach a report unnoticed.
 */
export async function resolveRouteFromWaypoints(points: LatLng[]): Promise<ResolveRouteResult> {
  const route = await routeThroughWaypoints(points);
  if (!route) {
    return { status: "route_failed", path: [], flags: [], roads: [], distanceKm: 0 };
  }

  return {
    status: "ok",
    path: route.polyline,
    flags: [],
    roads: route.roads,
    distanceKm: route.distanceMeters / 1000,
  };
}
