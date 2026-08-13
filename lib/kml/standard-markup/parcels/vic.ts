// VIC equivalent of ./qld.ts — same Vicmap_Parcel service already used by
// lib/property-sizing/vic.ts, but an envelope query instead of a point query.
// Free, no API key. VIC has no fuzzy-match confidence score (matchScore is always null).

import type { LatLng } from "@/lib/kml/types";
import { geocodeVic, splitStreet } from "@/lib/property-sizing/vic";
import { envelopeAroundPoint } from "../geometry";
import type { ParcelFeature, ParcelQueryResult } from "./types";

const PARCEL_URL = "https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Parcel/FeatureServer/0/query";
const ENVELOPE_HALF_WIDTH_M = 60;

interface ParcelResp {
  features?: { attributes?: { parcel_spi?: string; Shape__Area?: number }; geometry?: { rings?: number[][][] } }[];
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

  const geo = await geocodeVic(split, addr);
  if (geo.status !== "ok") return null;
  const { x, y, matchedAddress } = geo;

  const env = envelopeAroundPoint(x, y, ENVELOPE_HALF_WIDTH_M);
  const p = await fetchJson<ParcelResp>(
    PARCEL_URL,
    new URLSearchParams({
      geometry: `${env.xmin},${env.ymin},${env.xmax},${env.ymax}`,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "parcel_spi,Shape__Area",
      returnGeometry: "true",
      outSR: "4326",
      f: "json",
    })
  );

  const candidates: ParcelFeature[] = (p.features ?? [])
    .map((f) => ({
      ring: outerRingToLatLng(f.geometry?.rings),
      idKey: String(f.attributes?.parcel_spi?.replace(/\\/g, "/") ?? ""),
      areaSqm: typeof f.attributes?.Shape__Area === "number" ? Math.round(f.attributes.Shape__Area) : null,
    }))
    .filter((f) => f.ring.length >= 3);

  return { point: { lat: y, lng: x }, matchedAddress, matchScore: null, candidates };
}
