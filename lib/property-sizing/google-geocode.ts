// Shared Google Geocoding API wrapper — address string in, lat/lng out.
//
// Both VIC and NSW geocode through this. VIC moved here because Vicmap has no working
// dedicated geocoder (see vic.ts's header for the full history). NSW moved here because
// the alternative, NSW Point, needs its own registered API key per environment for the
// address->point step alone, while the part that actually matters — the DCDB cadastre —
// is open and unauthenticated. One less key to provision, one less portal to depend on.
//
// QLD keeps its own QldLocator geocoder: it's open, needs no key, and returns a real
// match score, so there's nothing to gain by moving it.

const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

interface GoogleGeocodeResp {
  status: string;
  error_message?: string;
  results?: {
    formatted_address?: string;
    types?: string[];
    partial_match?: boolean;
    geometry?: { location?: { lat: number; lng: number }; location_type?: string };
  }[];
}

// Google always answers with *something*: ask it for "999 Nonexistent Rd, Nowhereville
// NSW" and it returns the centroid of New South Wales, status OK. Feeding that to a
// cadastre query yields a random outback parcel that renders as a perfectly convincing
// site markup — the worst kind of wrong for an inspection document. A precise hit is
// either typed as an actual address/building, or pinned to a rooftop / interpolated
// along a street; anything that only resolved to a suburb, postcode or state is not an
// address and gets rejected.
const PRECISE_RESULT_TYPES = new Set(["street_address", "premise", "subpremise"]);
const PRECISE_LOCATION_TYPES = new Set(["ROOFTOP", "RANGE_INTERPOLATED"]);

export type GoogleGeocodeOutcome =
  | { status: "ok"; x: number; y: number; matchedAddress: string | null }
  /** Nothing matched, or the only match was too coarse to be a real address. */
  | { status: "no_candidates" }
  | { status: "no_location"; matchedAddress: string | null };

async function fetchJson<T>(url: string, params: URLSearchParams, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}?${params.toString()}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Geocodes a single-line Australian address. `x` is longitude, `y` is latitude —
 * matching the ArcGIS convention the state cadastre queries already use.
 *
 * Throws if the key is missing or Google returns a hard error; returns a status for the
 * two soft outcomes (nothing matched / matched but no coordinates) so callers can tell
 * "bad address" apart from "service broken".
 */
export async function geocodeViaGoogle(addressLine: string, timeoutMs = 8000): Promise<GoogleGeocodeOutcome> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY not configured — geocoding needs the Geocoding API enabled on the same key used for Site Markup."
    );
  }

  const resp = await fetchJson<GoogleGeocodeResp>(
    GOOGLE_GEOCODE_URL,
    new URLSearchParams({ address: addressLine, region: "au", key }),
    timeoutMs
  );

  if (resp.status === "ZERO_RESULTS") return { status: "no_candidates" };
  if (resp.status !== "OK" || !resp.results?.length) {
    throw new Error(`Google geocode ${resp.status}${resp.error_message ? `: ${resp.error_message}` : ""}`);
  }

  const top = resp.results[0];
  const isPrecise =
    (top.types ?? []).some((t) => PRECISE_RESULT_TYPES.has(t)) ||
    PRECISE_LOCATION_TYPES.has(top.geometry?.location_type ?? "");
  // Reported as "not found" rather than its own status: from the operator's point of
  // view a suburb-level hit is the same problem as no hit — the address needs checking.
  if (!isPrecise) return { status: "no_candidates" };

  const location = top.geometry?.location;
  const matchedAddress = top.formatted_address ?? null;
  if (!location) return { status: "no_location", matchedAddress };
  return { status: "ok", x: location.lng, y: location.lat, matchedAddress };
}
