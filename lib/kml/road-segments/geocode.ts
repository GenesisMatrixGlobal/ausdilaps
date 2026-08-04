// Suburb-level geocoding via OSM Nominatim — free, no key. Used only to get a
// bounding box to search within; cross-street intersections are found from OSM
// road topology directly (graph.ts), not by geocoding each cross-street —
// live testing against real council data showed Nominatim's free-text search
// unreliable at street level (e.g. it matched a park instead of a street for
// "St Andrews St", and missed real boundary roads like "Logan Rd" near "Kuraby"
// even though both are correctly mapped in OSM).

import type { LatLng } from "@/lib/kml/types";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "AusDilaps-KML-RoadTracer/1.0 (+https://ausdilaps.com.au, info@ausdilaps.com.au)";
/** Nominatim's usage policy caps requests at 1/sec — serialise every call through this queue. */
const MIN_INTERVAL_MS = 1100;

let queue: Promise<void> = Promise.resolve();

function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn);
  queue = result.then(
    () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS)),
    () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS))
  );
  return result;
}

interface NominatimRow {
  lat: string;
  lon: string;
}

export async function geocodeSuburb(location: string, regionHint = "Queensland, Australia"): Promise<LatLng | null> {
  if (!location.trim()) return null;

  return throttle(async () => {
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set("q", `${location}, ${regionHint}`);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "au");

    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const rows = (await res.json()) as NominatimRow[];
    const top = rows[0];
    if (!top) return null;
    return { lat: Number(top.lat), lng: Number(top.lon) };
  });
}
