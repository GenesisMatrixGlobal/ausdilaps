// Independent real-world sanity-check for a measured shape: given a lat/lng (from the
// georeferenced pixel position), look up the actual building footprint there and compare.
// Google Solar API is primary (the source Rhys picked); OpenStreetMap's Overpass API is an
// automatic, free fallback for the documented coverage gaps in Solar API — and for today,
// before Solar API is enabled on the project's Google Cloud key at all. Either path degrades
// to "not found" rather than throwing, since this is a sanity-check, not a hard dependency.
import { projectToLocalMetres, type LatLng } from "./georeference";

export interface ExternalFootprint {
  areaSqm: number;
}

async function queryGoogleSolarFootprint(latLng: LatLng): Promise<ExternalFootprint | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  const url = new URL("https://solar.googleapis.com/v1/buildingInsights:findClosest");
  url.searchParams.set("location.latitude", String(latLng.lat));
  url.searchParams.set("location.longitude", String(latLng.lng));
  url.searchParams.set("key", key);

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch {
    return null;
  }
  if (!res.ok) return null; // NOT_FOUND (no building nearby) or Solar API not enabled yet — both fall through to OSM

  const data = (await res.json()) as { solarPotential?: { wholeRoofStats?: { groundAreaMeters2?: number } } };
  const areaSqm = data.solarPotential?.wholeRoofStats?.groundAreaMeters2;
  if (!areaSqm || areaSqm <= 0) return null;
  return { areaSqm };
}

interface OverpassGeomPoint {
  lat: number;
  lon: number;
}

interface OverpassWay {
  type: string;
  geometry?: OverpassGeomPoint[];
}

/** Ray-casting point-in-polygon test in raw lat/lng — fine at this scale, no projection needed. */
function pointInRing(point: LatLng, ring: OverpassGeomPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lon, yi = ring[i].lat;
    const xj = ring[j].lon, yj = ring[j].lat;
    const intersects = yi > point.lat !== yj > point.lat && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function ringAreaSqm(ring: OverpassGeomPoint[]): number {
  if (ring.length < 3) return 0;
  const origin: LatLng = { lat: ring[0].lat, lng: ring[0].lon };
  const projected = ring.map((p) => projectToLocalMetres(origin, { lat: p.lat, lng: p.lon }));
  let sum = 0;
  for (let i = 0; i < projected.length; i++) {
    const a = projected[i];
    const b = projected[(i + 1) % projected.length];
    sum += a.east * b.north - b.east * a.north;
  }
  return Math.abs(sum) / 2;
}

// Overpass asks callers to keep sustained load to roughly 1 request/second — and its public
// instance will start returning 406/429 for a burst that pushes past that, which is recoverable
// with a short cooldown rather than a real "no data here" (confirmed live: a burst of ~130
// requests during testing triggered 406s that cleared themselves after a few seconds' pause).
let overpassQueue: Promise<unknown> = Promise.resolve();
function throttledOverpass<T>(fn: () => Promise<T>): Promise<T> {
  const run = overpassQueue.then(fn, fn);
  overpassQueue = run.catch(() => undefined).then(() => new Promise((resolve) => setTimeout(resolve, 1500)));
  return run;
}

async function fetchOverpass(latLng: LatLng): Promise<Response | null> {
  const query = `[out:json][timeout:15];way["building"](around:50,${latLng.lat},${latLng.lng});out geom;`;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  try {
    return await fetch(url);
  } catch {
    return null;
  }
}

function isThrottleStatus(res: Response | null): boolean {
  return !res || res.status === 406 || res.status === 429;
}

// Circuit breaker: a plan can have 100+ buildings, and the measure route has a hard 290s
// budget — confirmed live that the public Overpass instance's block, once tripped, does NOT
// clear within a run, so retrying per-building is not just wasteful but a real risk of blowing
// the route's timeout. Trip on the very first throttle response and skip the queue entirely
// (not just the fetch) for the rest of this run, so a blocked run costs one failed call, not
// N × (retries + queue delay). A run that's never throttled never touches this.
const OVERPASS_COOLDOWN_MS = 120_000;
let overpassBlockedUntil = 0;

async function queryOsmFootprint(latLng: LatLng): Promise<ExternalFootprint | null> {
  if (Date.now() < overpassBlockedUntil) return null;

  return throttledOverpass(async () => {
    if (Date.now() < overpassBlockedUntil) return null;

    let res = await fetchOverpass(latLng);
    // A single 406/429 gets one quick retry in case it's a genuine one-off blip; a second
    // throttle response trips the breaker for the rest of this run.
    if (isThrottleStatus(res)) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      res = await fetchOverpass(latLng);
    }

    if (isThrottleStatus(res)) {
      overpassBlockedUntil = Date.now() + OVERPASS_COOLDOWN_MS;
      return null;
    }

    if (!res || !res.ok) return null;

    const data = (await res.json()) as { elements?: OverpassWay[] };
    const ways = (data.elements ?? []).filter((w) => w.geometry && w.geometry.length >= 3);
    if (ways.length === 0) return null;

    const containing = ways.find((w) => pointInRing(latLng, w.geometry!));
    const chosen = containing ?? ways[0];
    const areaSqm = ringAreaSqm(chosen.geometry!);
    if (areaSqm <= 0) return null;
    return { areaSqm };
  });
}

export interface ExternalCheck {
  source: "google-solar" | "osm" | null;
  areaSqm: number | null;
}

export async function checkExternalFootprint(latLng: LatLng): Promise<ExternalCheck> {
  const google = await queryGoogleSolarFootprint(latLng);
  if (google) return { source: "google-solar", areaSqm: google.areaSqm };

  const osm = await queryOsmFootprint(latLng);
  if (osm) return { source: "osm", areaSqm: osm.areaSqm };

  return { source: null, areaSqm: null };
}
