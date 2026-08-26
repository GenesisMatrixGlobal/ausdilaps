// Reverse geocoding for road segments — lat/lng in, locality / council / postcode out.
//
// Mirrors lib/property-sizing/google-geocode.ts (same API, same key, same timeout shape)
// but inverted: that module resolves an address to a point and rejects anything coarser
// than a rooftop. Here coarse IS the answer — we want the town and the council area a
// stretch of road runs through, so the useful data lives in address_components rather
// than in the geometry.
//
// Why this and not OSM, when enrich.ts is already talking to Overpass: OSM ways carry no
// reliable locality or postcode, and Nominatim's usage policy caps reverse lookups at
// 1/sec, which is over two minutes for a 123-segment network. GOOGLE_MAPS_API_KEY is
// already provisioned for Site Markup and Geocoding bills at ~$0.60 per full network.

import type { LatLng } from "@/lib/kml/types";

const GOOGLE_REVERSE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

interface AddressComponent {
  long_name?: string;
  short_name?: string;
  types?: string[];
}

interface GoogleReverseResp {
  status: string;
  error_message?: string;
  results?: { address_components?: AddressComponent[] }[];
}

export interface ReverseGeocodeResult {
  locality: string | null;
  /** Local government area. In NSW that is administrative_area_level_2. */
  lga: string | null;
  postcode: string | null;
}

const EMPTY: ReverseGeocodeResult = { locality: null, lga: null, postcode: null };

/**
 * Locality preference, most specific first. Rural NSW road midpoints frequently sit
 * outside any gazetted `locality`, in which case Google answers with a `neighborhood` or
 * only an `administrative_area_level_3`, so walk down rather than give up.
 */
const LOCALITY_TYPES = ["locality", "neighborhood", "administrative_area_level_3"];

function pick(components: AddressComponent[], type: string): string | null {
  return components.find((c) => (c.types ?? []).includes(type))?.long_name ?? null;
}

/** Restricting the result set keeps a road midpoint from resolving to a random driveway. */
const RESULT_TYPES = "locality|administrative_area_level_2|postal_code|route";

export async function reverseGeocode(point: LatLng, timeoutMs = 8000): Promise<ReverseGeocodeResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY not configured — locality lookup needs the Geocoding API enabled on the same key used for Site Markup."
    );
  }

  const params = new URLSearchParams({
    latlng: `${point.lat},${point.lng}`,
    result_type: RESULT_TYPES,
    key,
  });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp: GoogleReverseResp;
  try {
    const res = await fetch(`${GOOGLE_REVERSE_GEOCODE_URL}?${params.toString()}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    resp = (await res.json()) as GoogleReverseResp;
  } finally {
    clearTimeout(t);
  }

  // A midpoint in the middle of nowhere legitimately returns nothing. That is a blank
  // cell in the CSV, not an error worth failing the whole enrichment run over.
  if (resp.status === "ZERO_RESULTS") return EMPTY;
  if (resp.status !== "OK" || !resp.results?.length) {
    throw new Error(`Google reverse geocode ${resp.status}${resp.error_message ? `: ${resp.error_message}` : ""}`);
  }

  // Google returns several results of decreasing precision; the field we want may only
  // be present on one of them, so flatten every component and search once.
  const components = resp.results.flatMap((r) => r.address_components ?? []);
  let locality: string | null = null;
  for (const type of LOCALITY_TYPES) {
    locality = pick(components, type);
    if (locality) break;
  }

  return {
    locality,
    lga: pick(components, "administrative_area_level_2"),
    postcode: pick(components, "postal_code"),
  };
}
