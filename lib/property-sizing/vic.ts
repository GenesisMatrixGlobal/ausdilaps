// Victoria lot-size lookup — free, no API key.
// Pipeline (validated live): address -> Vicmap_Address attribute query (house number +
// road name + locality + postcode) -> point-in-polygon query against Vicmap_Parcel ->
// Shape__Area in m². Both are public ArcGIS Online hosted feature services (DataVic).
// Returns the parcel geometry too, for the building-attributes step.

import type { LotResult } from "./types";

const ADDRESS_URL =
  "https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/arcgis/rest/services/Vicmap_Address/FeatureServer/0/query";
const PARCEL_URL =
  "https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Parcel/FeatureServer/0/query";

interface AddressFeature {
  attributes?: { ezi_address?: string; is_primary?: string };
  geometry?: { x: number; y: number };
}
interface AddressResp {
  features?: AddressFeature[];
}
interface ParcelFeature {
  attributes?: { parcel_spi?: string; Shape__Area?: number };
  geometry?: { rings?: number[][][] };
}
interface ParcelResp {
  features?: ParcelFeature[];
}

async function fetchJson<T>(url: string, params: URLSearchParams, timeoutMs = 12000): Promise<T> {
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

/** Queries Vicmap_Address for a house number + road name + locality — free, no API key. */
export async function geocodeVic(
  split: { houseNumber: string; roadName: string },
  addr: { suburb: string; postcode?: string }
): Promise<VicGeocodeOutcome> {
  const whereParts = [
    `house_number_1=${Number(split.houseNumber)}`,
    `UPPER(road_name) LIKE UPPER('${split.roadName.replace(/'/g, "''")}%')`,
    `UPPER(locality_name)=UPPER('${addr.suburb.replace(/'/g, "''")}')`,
  ];
  if (addr.postcode) whereParts.push(`postcode='${addr.postcode}'`);

  const a = await fetchJson<AddressResp>(
    ADDRESS_URL,
    new URLSearchParams({
      where: whereParts.join(" AND "),
      outFields: "ezi_address,is_primary",
      returnGeometry: "true",
      outSR: "4326",
      f: "json",
    })
  );
  const feats = a.features ?? [];
  if (!feats.length) return { status: "no_candidates" };

  // Prefer the primary address point when several rows match (large/multi-lot sites).
  const primary = feats.find((f) => f.attributes?.is_primary === "Y") ?? feats[0];
  const { x, y } = primary.geometry ?? {};
  const matchedAddress = primary.attributes?.ezi_address ?? null;
  if (x == null || y == null) return { status: "no_location", matchedAddress };
  return { status: "ok", x, y, matchedAddress };
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
