// Intersection geocoding via the Google Geocoding API — paid (Google gives a $200/mo
// free credit), needs GOOGLE_MAPS_API_KEY. Confirmed live against real council data:
// Google resolves "StreetA & StreetB, Suburb" intersection queries cleanly and covers
// roads OSM/Nominatim didn't have mapped at all (e.g. "St Andrews St" near Kuraby).

import type { GeocodedIntersection } from "./types";

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/** A config-level failure (bad key, API/billing not enabled) — distinct from a per-row "not found". */
export class GoogleMapsConfigError extends Error {}

interface GeocodeResponse {
  status: string;
  error_message?: string;
  results?: {
    formatted_address: string;
    types: string[];
    geometry: { location: { lat: number; lng: number } };
  }[];
}

async function callGoogleMaps<T extends { status: string; error_message?: string }>(
  url: URL,
  retries = 2
): Promise<T> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new GoogleMapsConfigError("GOOGLE_MAPS_API_KEY not configured");
  url.searchParams.set("key", key);

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    const data = (await res.json()) as T;
    if (data.status === "REQUEST_DENIED" || data.status === "INVALID_REQUEST") {
      throw new GoogleMapsConfigError(
        `Google Maps ${data.status}: ${data.error_message ?? "check GOOGLE_MAPS_API_KEY and that the API + billing are enabled"}`
      );
    }
    if (data.status === "OK" || data.status === "ZERO_RESULTS") return data;
    // OVER_QUERY_LIMIT / UNKNOWN_ERROR — transient, worth a retry.
    if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error("Google Maps request failed after retries");
}

export async function geocodeIntersection(
  roadName: string,
  crossDesc: string,
  location: string,
  regionHint = "QLD, Australia"
): Promise<GeocodedIntersection | null> {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set("address", `${roadName} & ${crossDesc}, ${location}, ${regionHint}`);
  url.searchParams.set("region", "au");

  const data = await callGoogleMaps<GeocodeResponse>(url);
  const top = data.results?.[0];
  if (data.status !== "OK" || !top) return null;

  return {
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    formattedAddress: top.formatted_address,
    isIntersection: top.types.includes("intersection"),
  };
}
