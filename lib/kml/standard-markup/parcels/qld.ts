// Fetches every QLD DCDB parcel intersecting a small envelope around a geocoded
// address — the subject parcel plus its true neighbours (filtered later, see
// ../neighbours.ts). Same free/no-key ArcGIS service as lib/property-sizing/qld.ts,
// just an envelope query instead of a point query so it returns more than one feature.

import type { LatLng } from "@/lib/kml/types";
import { geocodeQld } from "@/lib/property-sizing/qld";
import { envelopeAroundPoint, ringAreaSqm } from "../geometry";
import { describeFetchError } from "./describe-fetch-error";
import type { ParcelFeature, ParcelKind, ParcelQueryResult } from "./types";

const CADASTRE_URL =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4/query";

/** Half-width of the query box, in metres — wide enough to reliably catch true
 *  side/rear neighbours (and across-the-road parcels, later filtered out geometrically). */
const ENVELOPE_HALF_WIDTH_M = 60;

interface CadastreResp {
  features?: {
    attributes?: { lotplan?: string; lot_area?: number; parcel_typ?: string };
    geometry?: { rings?: number[][][] };
  }[];
}

/** QLD spells the discriminator out in `parcel_typ`: "Lot Type Parcel",
 *  "Road Type Parcel", or "Unlinked parcel or interest" for easements. Matched by prefix
 *  rather than equality so a wording change doesn't silently reclassify every parcel. */
function qldParcelKind(parcelTyp: string | undefined): ParcelKind {
  const t = (parcelTyp ?? "").trim().toLowerCase();
  if (t.startsWith("road")) return "road";
  if (t.startsWith("lot")) return "lot";
  return "other";
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
  const geoStart = Date.now();
  let geo: Awaited<ReturnType<typeof geocodeQld>>;
  try {
    geo = await geocodeQld(addr);
  } catch (e) {
    throw new Error(`QLD geocode ${describeFetchError(e, Date.now() - geoStart)}`);
  }
  if (!geo) return null;
  const { x, y, matchedAddress, matchScore } = geo;

  return { point: { lat: y, lng: x }, matchedAddress, matchScore, candidates: await fetchParcelsNearPointQld(x, y) };
}

/** The envelope query on its own, with no geocoding — shared by the address pipeline
 *  above and by the click-a-lot lookup in ../parcel-at-point.ts, so the cadastre endpoint
 *  and its response shape stay defined in exactly one place. */
export async function fetchParcelsNearPointQld(
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
        `&outFields=lotplan,lot_area,parcel_typ&returnGeometry=true&outSR=4326&f=json`
    );
  } catch (e) {
    throw new Error(`QLD parcel query ${describeFetchError(e, Date.now() - parcelStart)}`);
  }

  return (c.features ?? [])
    .map((f) => ({
      ring: outerRingToLatLng(f.geometry?.rings),
      idKey: String(f.attributes?.lotplan ?? ""),
      // Computed from the ring, not read from the cadastre. See ringAreaSqm — NSW and VIC
      // publish areas in Web Mercator, inflated by 1/cos^2(latitude) (1.45x Sydney, 1.6x
      // Melbourne). Computing it makes one rule that is right in every state.
      areaSqm: null,
      kind: qldParcelKind(f.attributes?.parcel_typ),
    }))
    .filter((f) => f.ring.length >= 3)
    .map((f) => ({ ...f, areaSqm: Math.round(ringAreaSqm(f.ring)) }));
}
