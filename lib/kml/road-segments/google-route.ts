// Shared per-row resolver: geocode a road-register row's FROM/TO cross-streets via
// Google and confirm a route between them follows the named road. Used by both the
// "Find Google Maps links" feature (maps-links.ts) and the Google-based KML tracer
// (trace-google.ts) so the geocode+directions orchestration exists in one place.

import type { RoadSegmentInput, GeocodedIntersection } from "./types";
import { geocodeIntersection } from "./google-geocode";
import { findRoadFollowingRoute, type RoadFollowingRoute } from "./google-directions";

export interface SegmentRouteResolution {
  origin: GeocodedIntersection | null;
  destination: GeocodedIntersection | null;
  route: RoadFollowingRoute | null;
  flags: string[];
}

function intersectionFlag(label: string, point: GeocodedIntersection): string | null {
  return point.isIntersection ? null : `"${label}" didn't resolve to an exact intersection — verify`;
}

export async function resolveSegmentRoute(segment: RoadSegmentInput): Promise<SegmentRouteResolution> {
  const flags: string[] = [];
  const [origin, destination] = await Promise.all([
    geocodeIntersection(segment.roadName, segment.fromDesc, segment.location, segment.regionHint),
    geocodeIntersection(segment.roadName, segment.toDesc, segment.location, segment.regionHint),
  ]);

  if (!origin || !destination) {
    if (!origin) flags.push(`couldn't locate "${segment.roadName} & ${segment.fromDesc}, ${segment.location}" — verify manually`);
    if (!destination) flags.push(`couldn't locate "${segment.roadName} & ${segment.toDesc}, ${segment.location}" — verify manually`);
    return { origin, destination, route: null, flags };
  }

  const originFlag = intersectionFlag(segment.fromDesc, origin);
  const destFlag = intersectionFlag(segment.toDesc, destination);
  if (originFlag) flags.push(originFlag);
  if (destFlag) flags.push(destFlag);

  const route = await findRoadFollowingRoute(origin, destination, segment.roadName);
  if (!route || !route.followsRoad) {
    flags.push(`couldn't confirm this route follows ${segment.roadName} — verify manually`);
  }

  return { origin, destination, route, flags };
}
