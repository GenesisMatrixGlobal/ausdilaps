// VIC equivalent of ./qld.ts — same Vicmap_Parcel service already used by
// lib/property-sizing/vic.ts, but an envelope query instead of a point query.
// Free, no API key. VIC has no fuzzy-match confidence score (matchScore is always null).

import type { LatLng } from "@/lib/kml/types";
import { geocodeVic, splitStreet } from "@/lib/property-sizing/vic";
import { envelopeAroundPoint } from "../geometry";
import { describeFetchError } from "./describe-fetch-error";
import type { ParcelFeature, ParcelQueryResult } from "./types";

const PARCEL_URL = "https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Parcel/FeatureServer/0/query";
const ENVELOPE_HALF_WIDTH_M = 60;

interface ParcelResp {
  features?: {
    attributes?: { parcel_spi?: string; Shape__Area?: number; parcel_road?: string };
    geometry?: { rings?: number[][][] };
  }[];
}

// Same generous timeout as lib/property-sizing/vic.ts — VIC's ArcGIS Online hosted
// feature services have been observed taking 12-15s to respond.
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

function outerRingToLatLng(rings?: number[][][]): LatLng[] {
  const ring = rings?.[0];
  if (!ring) return [];
  return ring.map(([lng, lat]) => ({ lat, lng }));
}

export async function fetchParcelsVic(addr: {
  street: string;
  suburb: string;
  postcode?: string;
}): Promise<ParcelQueryResult | null> {
  const split = splitStreet(addr.street);
  if (!split) return null;

  const geoStart = Date.now();
  let geo: Awaited<ReturnType<typeof geocodeVic>>;
  try {
    geo = await geocodeVic(split, addr);
  } catch (e) {
    throw new Error(`VIC geocode ${describeFetchError(e, Date.now() - geoStart)}`);
  }
  if (geo.status !== "ok") return null;
  const { x, y, matchedAddress } = geo;

  return { point: { lat: y, lng: x }, matchedAddress, matchScore: null, candidates: await fetchParcelsNearPointVic(x, y) };
}

/** The envelope query on its own, with no geocoding — shared by the address pipeline
 *  above and by the click-a-lot lookup in ../parcel-at-point.ts. */
export async function fetchParcelsNearPointVic(
  lng: number,
  lat: number,
  halfWidthM: number = ENVELOPE_HALF_WIDTH_M
): Promise<ParcelFeature[]> {
  const env = envelopeAroundPoint(lng, lat, halfWidthM);
  const parcelStart = Date.now();
  let p: ParcelResp;
  try {
    p = await fetchJson<ParcelResp>(
      PARCEL_URL,
      new URLSearchParams({
        geometry: `${env.xmin},${env.ymin},${env.xmax},${env.ymax}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "parcel_spi,Shape__Area,parcel_road",
        returnGeometry: "true",
        outSR: "4326",
        f: "json",
      })
    );
  } catch (e) {
    throw new Error(`VIC parcel query ${describeFetchError(e, Date.now() - parcelStart)}`);
  }

  return (p.features ?? [])
    .map((f) => ({
      ring: outerRingToLatLng(f.geometry?.rings),
      idKey: String(f.attributes?.parcel_spi?.replace(/\\/g, "/") ?? ""),
      areaSqm: typeof f.attributes?.Shape__Area === "number" ? Math.round(f.attributes.Shape__Area) : null,
      // Vicmap's own road flag. VIC has no easement/"other" equivalent to QLD's unlinked
      // parcels, so everything not flagged as road is a lot.
      kind: f.attributes?.parcel_road === "Y" ? ("road" as const) : ("lot" as const),
    }))
    .filter((f) => f.ring.length >= 3);
}
