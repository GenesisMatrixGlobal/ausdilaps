// NSW equivalent of ./qld.ts — same NSW SIX Maps DCDB Lot layer already used by
// lib/property-sizing/nsw.ts, but an envelope query instead of a point query.
// Geocodes via Google (same as the property-sizing tool); the SIX Maps cadastre is open.

import type { LatLng } from "@/lib/kml/types";
import { geocodeNsw } from "@/lib/property-sizing/nsw";
import { envelopeAroundPoint } from "../geometry";
import { describeFetchError } from "./describe-fetch-error";
import type { ParcelFeature, ParcelQueryResult } from "./types";

const CADASTRE_URL = "https://maps.six.nsw.gov.au/arcgis/rest/services/sixmaps/Boundaries/MapServer/15/query";
const ENVELOPE_HALF_WIDTH_M = 60;

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

function outerRingToLatLng(rings?: number[][][]): LatLng[] {
  const ring = rings?.[0];
  if (!ring) return [];
  return ring.map(([lng, lat]) => ({ lat, lng }));
}

export async function fetchParcelsNsw(addr: {
  street: string;
  suburb: string;
  postcode?: string;
}): Promise<ParcelQueryResult | null> {
  const geoStart = Date.now();
  let geo: Awaited<ReturnType<typeof geocodeNsw>>;
  try {
    geo = await geocodeNsw(addr);
  } catch (e) {
    throw new Error(`NSW geocode ${describeFetchError(e, Date.now() - geoStart)}`);
  }
  if (!geo) return null;
  const { x, y, matchedAddress, matchScore } = geo;

  return { point: { lat: y, lng: x }, matchedAddress, matchScore, candidates: await fetchParcelsNearPointNsw(x, y) };
}

/** The envelope query on its own, with no geocoding — shared by the address pipeline
 *  above and by the click-a-lot lookup in ../parcel-at-point.ts. */
export async function fetchParcelsNearPointNsw(
  lng: number,
  lat: number,
  halfWidthM: number = ENVELOPE_HALF_WIDTH_M
): Promise<ParcelFeature[]> {
  const env = envelopeAroundPoint(lng, lat, halfWidthM);
  const parcelStart = Date.now();
  let c: CadastreResp;
  try {
    c = await fetchJson<CadastreResp>(
      `${CADASTRE_URL}?geometry=${env.xmin},${env.ymin},${env.xmax},${env.ymax}` +
        `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects` +
        `&outFields=lotidstring,planlabel,planlotarea,shape_Area&returnGeometry=true&outSR=4326&f=json`
    );
  } catch (e) {
    throw new Error(`NSW parcel query ${describeFetchError(e, Date.now() - parcelStart)}`);
  }

  return (c.features ?? [])
    .map((f) => {
      const attrs = f.attributes;
      const area = attrs?.planlotarea ?? attrs?.shape_Area;
      return {
        ring: outerRingToLatLng(f.geometry?.rings),
        // lotidstring ("1//DP29132") is per-lot; planlabel ("DP29132") is the plan, which
        // several lots in the same subdivision share. Preferring planlabel gave sibling
        // lots identical ids, so the UI treated them as one parcel — ticking or excluding
        // one silently did the same to the other.
        idKey: String(attrs?.lotidstring || attrs?.planlabel || ""),
        areaSqm: typeof area === "number" ? Math.round(area) : null,
        // Layer 15 is the Lot layer — it holds no road reserves to filter out. Checked
        // against a Baulkham Hills block: 50 parcels, every one with a lot id.
        kind: "lot" as const,
      };
    })
    .filter((f) => f.ring.length >= 3);
}
