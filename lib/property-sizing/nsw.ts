// New South Wales lot-size lookup — free, no state API key needed.
// Pipeline: address -> Google Geocoding API -> point-in-polygon query against the NSW
// DCDB Lot layer -> planlotarea (falls back to shape_Area) in m².
// Returns the parcel geometry too, for the building-attributes step.
//
// Geocoding previously went through the NSW Point service, which required a registered
// NSW_POINT_API_KEY embedded in the request path. That key covered the address->point
// step only; the SIX Maps cadastre below is open and unauthenticated, so dropping NSW
// Point in favour of the Google key already provisioned for Site Markup removes a
// signup and an environment variable without losing access to any NSW-only data.
// Trade-off: Google returns no match score, so matchScore is null here — same as VIC.

import type { LotResult } from "./types";
import { geocodeViaGoogle } from "./google-geocode";

const CADASTRE_URL = "https://maps.six.nsw.gov.au/arcgis/rest/services/sixmaps/Boundaries/MapServer/15/query";

interface CadastreResp {
  features?: {
    attributes?: { lotidstring?: string; planlabel?: string; planlotarea?: number; shape_Area?: number };
    geometry?: { rings?: number[][][] };
  }[];
}

async function fetchJson<T>(url: string, timeoutMs = 12000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export interface NswGeocodeResult {
  x: number;
  y: number;
  matchedAddress: string | null;
  matchScore: number | null;
}

/** Geocodes a NSW address via Google. Returns null if nothing matched. */
export async function geocodeNsw(addr: {
  street: string;
  suburb: string;
  postcode?: string;
}): Promise<NswGeocodeResult | null> {
  const addressLine = `${addr.street}, ${addr.suburb} NSW${addr.postcode ? ` ${addr.postcode}` : ""}, Australia`;
  const geo = await geocodeViaGoogle(addressLine);
  if (geo.status !== "ok") return null;
  return { x: geo.x, y: geo.y, matchedAddress: geo.matchedAddress, matchScore: null };
}

export async function lookupNsw(addr: { street: string; suburb: string; postcode?: string }): Promise<LotResult> {
  let geo: NswGeocodeResult | null;
  try {
    geo = await geocodeNsw(addr);
  } catch (e) {
    return { status: "error", flags: [`geocode failed: ${(e as Error).message}`] };
  }
  if (!geo) {
    return { status: "not_found", flags: ["address not found — verify / measure manually"] };
  }

  const { x, y, matchedAddress, matchScore } = geo;

  try {
    const c = await fetchJson<CadastreResp>(
      `${CADASTRE_URL}?geometry=${x},${y}&geometryType=esriGeometryPoint&inSR=4326` +
        `&spatialRel=esriSpatialRelIntersects&outFields=lotidstring,planlabel,planlotarea,shape_Area` +
        `&returnGeometry=true&outSR=4326&f=json`
    );
    const feat = c.features?.[0];
    const attrs = feat?.attributes;
    const area = attrs?.planlotarea ?? attrs?.shape_Area;
    if (!attrs || area == null) {
      return {
        status: "no_parcel",
        matchedAddress,
        matchScore,
        _lon: x,
        _lat: y,
        flags: ["no titled parcel at this point — measure manually"],
      };
    }
    return {
      status: "ok",
      lotSizeSqm: Math.round(area),
      lotPlan: attrs.planlabel ?? attrs.lotidstring ?? null,
      matchedAddress,
      matchScore,
      source: "NSW DCDB",
      _lon: x,
      _lat: y,
      _parcelRings: feat?.geometry?.rings,
      flags: [],
    };
  } catch (e) {
    return { status: "error", matchedAddress, matchScore, _lon: x, _lat: y, flags: [`cadastre failed: ${(e as Error).message}`] };
  }
}
