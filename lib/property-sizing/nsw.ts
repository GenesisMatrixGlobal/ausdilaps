// New South Wales lot-size lookup — free, requires a self-service NSW Point API key.
// Pipeline: address -> NSW Point geocoder (findAddressCandidates) -> point-in-polygon
// query against the NSW DCDB Lot layer -> planlotarea (falls back to shape_Area) in m².
// Returns the parcel geometry too, for the building-attributes step.
// Register for a free key at the NSW Spatial Services "NSW Point" portal, then set
// NSW_POINT_API_KEY in .env.local.

import type { LotResult } from "./types";

const CADASTRE_URL = "https://maps.six.nsw.gov.au/arcgis/rest/services/sixmaps/Boundaries/MapServer/15/query";

interface GeocodeResp {
  candidates?: { address?: string; score?: number; location?: { x: number; y: number } }[];
}
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

/** Geocodes an AU address via the NSW Point geocoder — needs `key` (NSW_POINT_API_KEY). Returns null if nothing matched. */
export async function geocodeNsw(
  addr: { street: string; suburb: string; postcode?: string },
  key: string
): Promise<NswGeocodeResult | null> {
  const singleLine = [addr.street, addr.suburb, "NSW", addr.postcode].filter(Boolean).join(", ");
  const geocodeUrl = `https://point.six.nsw.gov.au/geo/arcgis/rest/services/${key}/NSWPoint/GeocodeServer/findAddressCandidates`;
  const g = await fetchJson<GeocodeResp>(
    `${geocodeUrl}?SingleLine=${encodeURIComponent(singleLine)}&f=json&outSR=4326&maxLocations=1`
  );
  const cand = g.candidates?.[0];
  if (!cand?.location) return null;
  return {
    x: cand.location.x,
    y: cand.location.y,
    matchedAddress: cand.address ?? null,
    matchScore: typeof cand.score === "number" ? cand.score : null,
  };
}

export async function lookupNsw(addr: { street: string; suburb: string; postcode?: string }): Promise<LotResult> {
  const key = process.env.NSW_POINT_API_KEY;
  if (!key) {
    return {
      status: "error",
      flags: ["NSW lookup not configured — missing NSW_POINT_API_KEY (register at the NSW Point portal)"],
    };
  }

  let geo: NswGeocodeResult | null;
  try {
    geo = await geocodeNsw(addr, key);
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
