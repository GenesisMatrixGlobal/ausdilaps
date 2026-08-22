// Google-based tracer — the primary path used by trace.ts when GOOGLE_MAPS_API_KEY is
// configured. Live-tested against real council data as more reliable than the free OSM
// tracer (trace-osm.ts): it correctly handled a divided road (Logan Rd) that sent the
// OSM pathfinder on a 13.7km wrong-carriageway detour, and resolved "St Andrews St",
// which isn't mapped in OSM at all. Costs a paid Geocoding + Directions API call per row
// (google-route.ts) — trace-osm.ts is the free fallback when no key is configured.

import type { RoadSegmentInput, RoadTraceResult } from "./types";
import { mapPool } from "@/lib/util/map-pool";
import { resolveSegmentRoute } from "./google-route";
import { pathLengthKm, lengthMismatchFlag } from "./geo";

async function traceOne(segment: RoadSegmentInput): Promise<RoadTraceResult> {
  const { origin, destination, route, flags } = await resolveSegmentRoute(segment);

  if (!origin || !destination) {
    return { input: segment, status: "geocode_failed", coordinates: null, tracedLengthKm: null, flags };
  }
  if (!route) {
    return { input: segment, status: "route_failed", coordinates: null, tracedLengthKm: null, flags };
  }

  const tracedLengthKm = pathLengthKm(route.polyline);
  const mismatch = lengthMismatchFlag(tracedLengthKm, segment.footpathLengthKm);
  const allFlags = mismatch ? [...flags, mismatch] : flags;

  return {
    input: segment,
    status: "ok",
    coordinates: route.polyline,
    tracedLengthKm,
    flags: allFlags,
    roads: route.roads,
  };
}

export async function traceRoadSegmentsGoogle(segments: RoadSegmentInput[]): Promise<RoadTraceResult[]> {
  return mapPool(segments, 8, traceOne);
}
