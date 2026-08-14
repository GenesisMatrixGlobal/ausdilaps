// Victoria lot-size lookup.
// Pipeline: address -> Google Geocoding API -> point-in-polygon query against
// Vicmap_Parcel -> Shape__Area in m².
//
// VIC has no working equivalent of QLD's QldLocator / NSW's NSWPoint dedicated
// geocoder. The obvious candidate — the Vicmap_Address ArcGIS Online hosted
// FeatureServer, queried with a house_number/road_name/locality WHERE clause — was
// used here previously, but live testing showed it regularly takes 25-30s+ and often
// times out entirely (confirmed: not caused by the LIKE wildcard — an exact-match
// query was equally slow). It's a generic hosted feature layer being queried like a
// database table, not a real geocoding service. A separate-looking GeocodeServer at
// corp-geo.mapshare.vic.gov.au/.../VMAddressEZIAdd turned out to be an unconfigured
// generic Esri World Geocoder template (returns nonsense POI matches). Vicmap_Parcel
// itself (the actual cadastral data — the thing only VIC government has) is fast and
// reliable (spatial envelope/point query, not attribute filtering) and is unchanged
// below. GOOGLE_MAPS_API_KEY is already provisioned for Site Markup's Static Maps
// calls and already needs the Geocoding API enabled alongside it (see
// .env.local.example) — no new setup.

import type { LotResult } from "./types";

const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const PARCEL_URL =
  "https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Parcel/FeatureServer/0/query";

interface GoogleGeocodeResp {
  status: string;
  error_message?: string;
  results?: { formatted_address?: string; geometry?: { location?: { lat: number; lng: number } } }[];
}
interface ParcelFeature {
  attributes?: { parcel_spi?: string; Shape__Area?: number };
  geometry?: { rings?: number[][][] };
}
interface ParcelResp {
  features?: ParcelFeature[];
}

// Vicmap_Parcel (an ArcGIS Online hosted feature service) has been observed taking
// 12-15s to respond on occasion — more headroom than QLD/NSW's own state-run services.
async function fetchJson<T>(url: string, params: URLSearchParams, timeoutMs = 25000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}?${params.toString()}`, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/** Split "8 Ironwood Ct" into a house number + road name, dropping the road type
 *  (VIC's road_name field excludes it) so "Ct" vs "Court" can't cause a mismatch. */
export function splitStreet(street: string): { houseNumber: string; roadName: string } | null {
  const m = street.trim().match(/^(\d+[a-z]?)\s+(.+?)(?:\s+[a-z]+)?$/i);
  if (!m) return null;
  const words = m[2].trim().split(/\s+/);
  // Drop a trailing road-type word (Ct, Court, St, Street, etc.) if there's more than one word.
  const roadName = words.length > 1 ? words.slice(0, -1).join(" ") : words[0];
  return { houseNumber: m[1], roadName };
}

export type VicGeocodeOutcome =
  | { status: "ok"; x: number; y: number; matchedAddress: string | null }
  | { status: "no_candidates" }
  | { status: "no_location"; matchedAddress: string | null };

/** Geocodes a VIC address via Google's Geocoding API (see the file-header comment for
 *  why — Vicmap has no working dedicated geocoder). */
export async function geocodeVic(
  split: { houseNumber: string; roadName: string },
  addr: { suburb: string; postcode?: string }
): Promise<VicGeocodeOutcome> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY not configured — VIC geocoding needs the Geocoding API enabled on the same key used for Site Markup."
    );
  }

  const addressLine = `${split.houseNumber} ${split.roadName}, ${addr.suburb} VIC${
    addr.postcode ? ` ${addr.postcode}` : ""
  }, Australia`;

  const resp = await fetchJson<GoogleGeocodeResp>(
    GOOGLE_GEOCODE_URL,
    new URLSearchParams({ address: addressLine, region: "au", key }),
    8000
  );

  if (resp.status === "ZERO_RESULTS") return { status: "no_candidates" };
  if (resp.status !== "OK" || !resp.results?.length) {
    throw new Error(`Google geocode ${resp.status}${resp.error_message ? `: ${resp.error_message}` : ""}`);
  }

  const top = resp.results[0];
  const location = top.geometry?.location;
  const matchedAddress = top.formatted_address ?? null;
  if (!location) return { status: "no_location", matchedAddress };
  return { status: "ok", x: location.lng, y: location.lat, matchedAddress };
}

export async function lookupVic(addr: { street: string; suburb: string; postcode?: string }): Promise<LotResult> {
  const split = splitStreet(addr.street);
  if (!split) {
    return { status: "not_found", flags: ["couldn't parse a house number from the street — verify manually"] };
  }

  let geo: VicGeocodeOutcome;
  try {
    geo = await geocodeVic(split, addr);
  } catch (e) {
    return { status: "error", flags: [`geocode failed: ${(e as Error).message}`] };
  }
  if (geo.status === "no_candidates") {
    return { status: "not_found", flags: ["address not found — verify / measure manually"] };
  }
  if (geo.status === "no_location") {
    return {
      status: "not_found",
      matchedAddress: geo.matchedAddress,
      flags: ["address matched but had no location — verify manually"],
    };
  }

  const { x, y, matchedAddress } = geo;

  try {
    const p = await fetchJson<ParcelResp>(
      PARCEL_URL,
      new URLSearchParams({
        geometry: `${x},${y}`,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "parcel_spi,Shape__Area",
        returnGeometry: "true",
        outSR: "4326",
        f: "json",
      })
    );
    const feat = p.features?.[0];
    const area = feat?.attributes?.Shape__Area;
    if (!feat || area == null) {
      return {
        status: "no_parcel",
        matchedAddress,
        _lon: x,
        _lat: y,
        flags: ["no titled parcel at this point — measure manually"],
      };
    }
    return {
      status: "ok",
      lotSizeSqm: Math.round(area),
      lotPlan: feat.attributes?.parcel_spi?.replace(/\\/g, "/") ?? null,
      matchedAddress,
      matchScore: null,
      source: "VIC Vicmap Property",
      _lon: x,
      _lat: y,
      _parcelRings: feat.geometry?.rings,
      flags: [],
    };
  } catch (e) {
    return { status: "error", matchedAddress, _lon: x, _lat: y, flags: [`cadastre failed: ${(e as Error).message}`] };
  }
}
