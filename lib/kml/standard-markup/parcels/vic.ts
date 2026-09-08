// VIC equivalent of ./qld.ts — same Vicmap_Parcel service already used by
// lib/property-sizing/vic.ts, but an envelope query instead of a point query.
// Free, no API key. VIC has no fuzzy-match confidence score (matchScore is always null).

import type { LatLng } from "@/lib/kml/types";
import { geocodeVic, splitStreet } from "@/lib/property-sizing/vic";
import { centroidOf, envelopeAroundPoint, ringAreaSqm } from "../geometry";
import { assertNoArcgisError } from "@/lib/arcgis";
import { describeFetchError } from "./describe-fetch-error";
import { PROPERTY_ID_PREFIX } from "./parcel-id";
import type { ParcelFeature, ParcelQueryResult } from "./types";

const PARCEL_URL = "https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Parcel/FeatureServer/0/query";

/** The fallback source. See fetchParcelsNearPointVic — Vicmap_Parcel is not always usable, and
 *  Vicmap_Property on the same (free, keyless) VIC org carries polygons for the same land. */
const PROPERTY_URL =
  "https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Property/FeatureServer/0/query";

const ENVELOPE_HALF_WIDTH_M = 60;

interface ParcelResp {
  features?: {
    attributes?: { parcel_spi?: string; Shape__Area?: number; parcel_road?: string };
    geometry?: { rings?: number[][][] };
  }[];
}

interface PropertyResp {
  features?: {
    attributes?: { prop_pfi?: string | number; prop_status?: string; propv_graphic_type?: string };
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

/**
 * The envelope query on its own, with no geocoding — shared by the address pipeline above and
 * by the click-a-lot lookup in ../parcel-at-point.ts.
 *
 * Tries the parcel cadastre, then falls back to Vicmap Property.
 *
 * ⚠ The fallback is not defensive over-engineering — it is there because Vicmap_Parcel was
 * observed FAILING IN PRODUCTION on 2026-09-08, mid-session: it started rejecting every
 * spatial query that returns records ("Cannot perform query. Invalid query parameters.", while
 * returnCountOnly kept working) and its feature count dropped to 120,400, about 3% of
 * Victoria. `parcel_lga_code='HOBSONS BAY'` and `='MELBOURNE'` both counted ZERO, so entire
 * cities were simply absent — a fixed query would still have found nothing. Vicmap_Property on
 * the same org was untouched throughout: 4,187,991 features, spatial queries fine.
 *
 * Parcel is tried FIRST every time, so the moment VIC restores the layer this returns to true
 * cadastral parcels with no code change. The fallback's cost is that a property PFI is not a
 * lot/plan — see ./parcel-id.ts — so the lot/plan column is blank while it is in use, and
 * resolve.ts flags that on the markup rather than letting it pass unremarked.
 */
export async function fetchParcelsNearPointVic(
  lng: number,
  lat: number,
  halfWidthM: number = ENVELOPE_HALF_WIDTH_M
): Promise<ParcelFeature[]> {
  try {
    const parcels = await fetchVicmapParcels(lng, lat, halfWidthM);
    if (parcels.length > 0) return parcels;
    console.warn("[standard-markup] VIC parcel layer returned no parcels — trying Vicmap Property");
  } catch (e) {
    console.warn(`[standard-markup] VIC parcel layer failed (${(e as Error).message}) — trying Vicmap Property`);
  }
  // Throws if this fails too, so a total outage reads as an outage rather than as an address
  // with no land under it.
  return fetchVicmapProperties(lng, lat, halfWidthM);
}

async function fetchVicmapParcels(
  lng: number,
  lat: number,
  halfWidthM: number
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

  // Before trusting an empty `features` — see lib/arcgis.ts. An outage must not be reported
  // to the operator as "no titled parcel at this address".
  assertNoArcgisError(p, "The VIC cadastre service");

  return (p.features ?? [])
    .map((f) => ({
      ring: outerRingToLatLng(f.geometry?.rings),
      idKey: String(f.attributes?.parcel_spi?.replace(/\\/g, "/") ?? ""),
      // Computed from the ring, not read from the cadastre. See ringAreaSqm — NSW and VIC
      // publish areas in Web Mercator, inflated by 1/cos^2(latitude) (1.45x Sydney, 1.6x
      // Melbourne). Computing it makes one rule that is right in every state.
      areaSqm: null,
      // Vicmap's own road flag. VIC has no easement/"other" equivalent to QLD's unlinked
      // parcels, so everything not flagged as road is a lot.
      kind: f.attributes?.parcel_road === "Y" ? ("road" as const) : ("lot" as const),
    }))
    .filter((f) => f.ring.length >= 3)
    .map((f) => ({ ...f, areaSqm: Math.round(ringAreaSqm(f.ring)) }));
}



/**
 * Vicmap PROPERTY polygons — the fallback source.
 *
 * Property boundaries, not cadastral parcels. For an ordinary suburban house the two are the
 * same outline; they diverge on strata and on properties spanning several parcels. For a
 * dilapidation markup that is an acceptable substitute — the thing being inspected is a
 * property — but it is a substitute, which is why the ids are prefixed and flagged.
 */
async function fetchVicmapProperties(
  lng: number,
  lat: number,
  halfWidthM: number
): Promise<ParcelFeature[]> {
  const env = envelopeAroundPoint(lng, lat, halfWidthM);
  const start = Date.now();
  let resp: PropertyResp;
  try {
    resp = await fetchJson<PropertyResp>(
      PROPERTY_URL,
      new URLSearchParams({
        geometry: `${env.xmin},${env.ymin},${env.xmax},${env.ymax}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "prop_pfi,prop_status,propv_graphic_type",
        returnGeometry: "true",
        outSR: "4326",
        f: "json",
      })
    );
  } catch (e) {
    throw new Error(`VIC property query ${describeFetchError(e, Date.now() - start)}`);
  }
  assertNoArcgisError(resp, "The VIC property service");

  return (resp.features ?? [])
    .filter((f) => {
      const a = f.attributes;
      // 'A' is active; retired property views are still in the layer.
      if (a?.prop_status !== "A") return false;
      // 'P' is the parcel-based property view, which is the land outline. Other graphic types
      // ('B' and friends) are building-level views that sit INSIDE a property and would arrive
      // as extra numbered "lots" stacked on top of the one they belong to.
      return a?.propv_graphic_type === "P";
    })
    .map((f) => ({
      ring: outerRingToLatLng(f.geometry?.rings),
      // Prefixed so nothing downstream mistakes a property PFI for a title reference — see
      // ./parcel-id.ts.
      idKey: `${PROPERTY_ID_PREFIX}${f.attributes?.prop_pfi ?? ""}`,
      areaSqm: null,
      // The property layer holds no road reserves, so everything in it is land someone owns.
      kind: "lot" as const,
    }))
    .filter((f) => f.ring.length >= 3)
    .map((f) => ({ ...f, areaSqm: Math.round(ringAreaSqm(f.ring)) }))
    .filter(dedupeByOutline());
}

/**
 * Drops property views that share an outline with one already seen.
 *
 * Vicmap Property holds one row per property, and a strata development has one property per
 * tenancy — all of them carrying the WHOLE parcel's outline. Verified at 88 Kingsway, Glen
 * Waverley: the shopping centre next door arrived as 13 rows, every one a 10,464 m² polygon at
 * the same place with a different prop_pfi. Unfiltered they stack 13 identical outlines on the
 * map and consume 13 of the numbered pins.
 *
 * Keyed on rounded area plus centroid rather than the vertex list, so it still collapses two
 * copies of a ring that start at a different vertex. Safe because two genuinely different
 * adjoining lots cannot share both an area and a centroid — that is the same piece of land.
 */
function dedupeByOutline(): (f: ParcelFeature) => boolean {
  const seen = new Set<string>();
  return (f) => {
    const c = centroidOf(f.ring);
    const key = `${f.areaSqm}@${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}
