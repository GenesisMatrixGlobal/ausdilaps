// Confirms a Directions API route actually travels along the named road (not just a
// shortest path that happens to start/end near it) — the Directions response has no
// structured road-name field, so road names only show up embedded in each step's
// `html_instructions` HTML string. Confirmed live against real council data, including
// the case that broke the free OSM tracer (a divided road, Logan Rd) and a road OSM
// didn't have mapped at all (St Andrews St) — Google's own routing handled both.

import type { LatLng } from "@/lib/kml/types";
import { roadNameVariants } from "./overpass";
import { decodePolyline } from "./polyline";
import { GoogleMapsConfigError } from "./google-geocode";

const DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json";

interface DirectionsStep {
  html_instructions: string;
  distance?: { value: number };
}

interface DirectionsLeg {
  distance?: { value: number };
  steps: DirectionsStep[];
}

interface DirectionsResponse {
  status: string;
  error_message?: string;
  routes?: {
    overview_polyline: { points: string };
    legs: DirectionsLeg[];
  }[];
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

export interface RoadLeg {
  /** Null where Google gave a step no road name at all. */
  name: string | null;
  distanceMeters: number;
}

/**
 * The road a step is *travelled on* is the bold span immediately following "on" or "onto":
 *
 *     Head <b>south</b> on <b>Brinkworth Rd</b> toward <b>O'Briens St</b>
 *     Turn <b>right</b> onto <b>Brinkworth Range Rd</b>
 *
 * Deliberately not every `<b>` span. Directions bolds the compass/turn direction too, and
 * the road after "toward" is one the route passes rather than drives — scraping all of them
 * returns "south", "right" and roads that were never entered. Verified live: the narrow rule
 * turned an 8-step response into exactly the 4 roads driven, summing to the API's own total.
 */
const TRAVELLED_ROAD = /\bon(?:to)?\b\s*<b>(.*?)<\/b>/i;

/** Ordered roads the route actually travels, with consecutive repeats merged.
 *
 *  Merging matters: a multi-waypoint route emits a tiny 3-6m step at each waypoint as it
 *  pauses and resumes on the same road, which would otherwise show up as duplicate rows. */
export function roadsTravelled(legs: DirectionsLeg[]): RoadLeg[] {
  const roads: RoadLeg[] = [];

  for (const leg of legs) {
    for (const step of leg.steps) {
      const match = TRAVELLED_ROAD.exec(step.html_instructions);
      const name = match ? stripHtml(match[1]).replace(/\s+/g, " ").trim() || null : null;
      const distanceMeters = step.distance?.value ?? 0;

      const previous = roads[roads.length - 1];
      if (previous && previous.name === name) {
        previous.distanceMeters += distanceMeters;
      } else {
        roads.push({ name, distanceMeters });
      }
    }
  }

  return roads;
}

/** Sheet road names and Google's canonical names sometimes differ by a trailing plural
 *  (sheet's "St Andrews St" vs Google's "St Andrew St") on top of the usual Rd/Road-style
 *  abbreviation differences — cheap enough to just generate both and check either. */
function desingularizeWords(value: string): string {
  return value.replace(/\b(\w{4,})s\b/gi, "$1");
}

function looseNameKeys(roadName: string): string[] {
  const base = roadNameVariants(roadName);
  const extra = base.map(desingularizeWords);
  return Array.from(new Set([...base, ...extra])).map((v) => v.toLowerCase());
}

function routeFollowsRoad(steps: { html_instructions: string }[], roadName: string): boolean {
  const text = steps
    .map((s) => stripHtml(s.html_instructions))
    .join(" ")
    .toLowerCase();
  return looseNameKeys(roadName).some((key) => text.includes(key));
}

async function fetchDirections(params: Record<string, string>): Promise<DirectionsResponse> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new GoogleMapsConfigError("GOOGLE_MAPS_API_KEY not configured");

  const url = new URL(DIRECTIONS_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("region", "au");
  url.searchParams.set("key", key);

  const res = await fetch(url);
  const data = (await res.json()) as DirectionsResponse;
  if (data.status === "REQUEST_DENIED" || data.status === "INVALID_REQUEST") {
    throw new GoogleMapsConfigError(
      `Google Directions ${data.status}: ${data.error_message ?? "check GOOGLE_MAPS_API_KEY and that the API + billing are enabled"}`
    );
  }
  return data;
}

export interface RoadFollowingRoute {
  polyline: LatLng[];
  followsRoad: boolean;
  /** Ordered roads the route travels. Often one entry here, but a trace that wandered off
   *  the named road shows up as two or more — which is worth surfacing. */
  roads: RoadLeg[];
}

/**
 * Gets directions between two points and checks the route actually uses `roadName`.
 * If the first attempt doesn't, retries once with a waypoint at the midpoint — a
 * best-effort nudge, not a guarantee; `followsRoad: false` on the returned route means
 * the caller should flag it for manual verification rather than trust it silently.
 *
 * `roadName` is optional so callers that supply raw coordinates (the Road Markup tool's
 * coordinate mode) can route between two points with no name to validate against. In that
 * case the first route is taken as-is and `followsRoad` stays false — it means "verified
 * against a named road", and there was no name to verify against.
 */
export async function findRoadFollowingRoute(
  origin: LatLng,
  destination: LatLng,
  roadName?: string
): Promise<RoadFollowingRoute | null> {
  const originStr = `${origin.lat},${origin.lng}`;
  const destStr = `${destination.lat},${destination.lng}`;

  const first = await fetchDirections({ origin: originStr, destination: destStr });
  let route = first.routes?.[0];

  // No name to check against: retrying with a midpoint waypoint couldn't be validated
  // either, so don't spend a second Directions call on it.
  if (!roadName) {
    if (!route) return null;
    return {
      polyline: decodePolyline(route.overview_polyline.points),
      followsRoad: false,
      roads: roadsTravelled(route.legs),
    };
  }
  if (route && routeFollowsRoad(route.legs.flatMap((l) => l.steps), roadName)) {
    return {
      polyline: decodePolyline(route.overview_polyline.points),
      followsRoad: true,
      roads: roadsTravelled(route.legs),
    };
  }

  const mid = { lat: (origin.lat + destination.lat) / 2, lng: (origin.lng + destination.lng) / 2 };
  const retried = await fetchDirections({
    origin: originStr,
    destination: destStr,
    waypoints: `${mid.lat},${mid.lng}`,
  });
  route = retried.routes?.[0] ?? route;
  if (!route) return null;

  return {
    polyline: decodePolyline(route.overview_polyline.points),
    followsRoad: routeFollowsRoad(route.legs.flatMap((l) => l.steps), roadName),
    roads: roadsTravelled(route.legs),
  };
}

export interface WaypointRoute {
  polyline: LatLng[];
  /** Road distance from Google, summed across legs. */
  distanceMeters: number;
  /** Ordered roads the route travels, consecutive repeats merged. */
  roads: RoadLeg[];
}

/**
 * Routes through an ordered list of points — origin, every intermediate stop, destination
 * — and returns the road-following path. Used by the Road Markup tool's Google-route mode,
 * where the points come out of a pasted directions URL.
 *
 * The intermediate points are sent as plain stopovers, deliberately without the `via:`
 * prefix: they were stopovers in the URL the operator built, and `via:` would let the route
 * pass them without actually turning at them.
 *
 * No road-name check here — a multi-leg route has no single road to validate against.
 *
 * `distanceMeters` comes from the API rather than measuring the returned polyline:
 * `overview_polyline` is simplified, so measuring it under-reports the real road distance.
 */
export async function routeThroughWaypoints(points: LatLng[]): Promise<WaypointRoute | null> {
  if (points.length < 2) return null;

  const origin = points[0];
  const destination = points[points.length - 1];
  const intermediate = points.slice(1, -1);

  const params: Record<string, string> = {
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
  };
  if (intermediate.length > 0) {
    params.waypoints = intermediate.map((p) => `${p.lat},${p.lng}`).join("|");
  }

  const response = await fetchDirections(params);
  const route = response.routes?.[0];
  if (!route) return null;

  const polyline = decodePolyline(route.overview_polyline.points);
  if (polyline.length < 2) return null;

  const distanceMeters = route.legs.reduce((total, leg) => total + (leg.distance?.value ?? 0), 0);
  return { polyline, distanceMeters, roads: roadsTravelled(route.legs) };
}
