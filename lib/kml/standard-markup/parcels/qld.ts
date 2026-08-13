// Fetches every QLD DCDB parcel intersecting a small envelope around a geocoded
// address — the subject parcel plus its true neighbours (filtered later, see
// ../neighbours.ts). Same free/no-key ArcGIS service as lib/property-sizing/qld.ts,
// just an envelope query instead of a point query so it returns more than one feature.

import type { LatLng } from "@/lib/kml/types";
import { geocodeQld } from "@/lib/property-sizing/qld";
import { envelopeAroundPoint } from "../geometry";
import type { ParcelFeature, ParcelQueryResult } from "./types";

const CADASTRE_URL =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4/query";

/** Half-width of the query box, in metres — wide enough to reliably catch true
 *  side/rear neighbours (and across-the-road parcels, later filtered out geometrically). */
const ENVELOPE_HALF_WIDTH_M = 60;

interface CadastreResp {
  features?: { attributes?: { lotplan?: string; lot_area?: number }; geometry?: { rings?: number[][][] } }[];
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

function outerRingToLatLng(rings?: number[][][]): LatLng[] {
  const ring = rings?.[0];
  if (!ring) return [];
  return ring.map(([lng, lat]) => ({ lat, lng }));
}

export async function fetchParcelsQld(addr: {
  street: string;
  suburb: string;
  postcode?: string;
}): Promise<ParcelQueryResult | null> {
  const geo = await geocodeQld(addr);
  if (!geo) return null;
  const { x, y, matchedAddress, matchScore } = geo;

  const env = envelopeAroundPoint(x, y, ENVELOPE_HALF_WIDTH_M);
  const c = await fetchJson<CadastreResp>(
    `${CADASTRE_URL}?geometry=${env.xmin},${env.ymin},${env.xmax},${env.ymax}` +
      `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects` +
      `&outFields=lotplan,lot_area&returnGeometry=true&outSR=4326&f=json`
  );

  const candidates: ParcelFeature[] = (c.features ?? [])
    .map((f) => ({
      ring: outerRingToLatLng(f.geometry?.rings),
      idKey: String(f.attributes?.lotplan ?? ""),
      areaSqm: typeof f.attributes?.lot_area === "number" ? Math.round(f.attributes.lot_area) : null,
    }))
    .filter((f) => f.ring.length >= 3);

  return { point: { lat: y, lng: x }, matchedAddress, matchScore, candidates };
}
