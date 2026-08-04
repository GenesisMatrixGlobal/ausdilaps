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

export interface ResolveRoadResult {
  status: RoadTraceStatus;
  /** The traced centerline between the two cross streets. Empty unless status is "ok". */
  path: LatLng[];
  flags: string[];
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
  return { status: result.status, path: result.coordinates ?? [], flags: result.flags };
}
