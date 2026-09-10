// The state address layers as a list of "this number on this road is HERE" features around a
// point — the raw material for ./verify-address.ts.
//
// Same three free, keyless ArcGIS services ./addresses.ts already reads for the sheet's Street
// cells, read the other way round: that module starts from lots and asks for their addresses;
// this one starts from a point and asks what addresses are nearby, so a requested address can
// be found by TEXT and its true position learned. No Google quota is spent.
//
// ⚠ THIS MODULE MUST NEVER THROW — same rule as addresses.ts. A failed lookup returns [] and
// the geocoded parcel stands, unverified. Verification is a safety net, not a dependency.

import { assertNoArcgisError } from "@/lib/arcgis";
import type { LatLng } from "@/lib/kml/types";
import { centroidOf, envelopeAroundPoint } from "../geometry";
import { ringAnchor } from "../measure";
import type { StandardMarkupState } from "../resolve";
import type { AddressFeatureLike } from "./address-match";

const QLD_URL =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/0/query";
const NSW_URL = "https://maps.six.nsw.gov.au/arcgis/rest/services/sixmaps/Boundaries/MapServer/8/query";
const VIC_URL =
  "https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Address/FeatureServer/0/query";

const TIMEOUT_MS = 12000;

export interface AddressFeature extends AddressFeatureLike {
  /** Where the address layer says the address is: a point INSIDE an NSW property polygon
   *  (ringAnchor, never the centroid — a strata block wrapping a courtyard has its centroid in
   *  the neighbour's yard), or a QLD / VIC address point. */
  point: LatLng;
  /** NSW only: the property polygon itself, so a parcel can be tested for lying INSIDE the
   *  property rather than merely containing one point of it. */
  ring?: LatLng[];
  full: string;
}

async function fetchJson<T>(url: string, params: URLSearchParams): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}?${params.toString()}`, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    assertNoArcgisError(body, "The address layer");
    return body as T;
  } finally {
    clearTimeout(t);
  }
}

function envelopeParams(point: LatLng, halfWidthM: number): Record<string, string> {
  const env = envelopeAroundPoint(point.lng, point.lat, halfWidthM);
  return {
    // FOUR coordinates, always — see addresses.ts.
    geometry: `${env.xmin},${env.ymin},${env.xmax},${env.ymax}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outSR: "4326",
    f: "json",
  };
}

// ── NSW: property polygons, "44 EASTERN AVENUE DOVER HEIGHTS" ─────────────────────────
interface NswResp {
  features?: { attributes?: { address?: string | null; housenumber?: string | null }; geometry?: { rings?: number[][][] } }[];
}

async function fetchNsw(point: LatLng, halfWidthM: number): Promise<AddressFeature[]> {
  const resp = await fetchJson<NswResp>(
    NSW_URL,
    new URLSearchParams({
      ...envelopeParams(point, halfWidthM),
      // Principal addresses only — without it every unit of every strata block comes back.
      where: "principaladdresstype=1",
      outFields: "address,housenumber",
      returnGeometry: "true",
    })
  );
  return (resp.features ?? []).flatMap((f) => {
    const full = String(f.attributes?.address ?? "").trim();
    const number = String(f.attributes?.housenumber ?? "").trim();
    const ring = (f.geometry?.rings?.[0] ?? []).map(([lng, lat]) => ({ lat, lng }));
    if (!full || !number || ring.length < 3) return [];
    const rest = full.startsWith(number) ? full.slice(number.length).trim() : full.replace(/^\S+\s*/, "");
    return [{ number, rest, full, ring, point: ringAnchor(ring) ?? centroidOf(ring) }];
  });
}

// ── QLD: address points with street_number / street_full / locality ─────────────────
interface QldResp {
  features?: {
    attributes?: { street_number?: string | number | null; street_full?: string | null; locality?: string | null; address?: string | null };
    geometry?: { x?: number; y?: number };
  }[];
}

async function fetchQld(point: LatLng, halfWidthM: number): Promise<AddressFeature[]> {
  const resp = await fetchJson<QldResp>(
    QLD_URL,
    new URLSearchParams({
      ...envelopeParams(point, halfWidthM),
      outFields: "street_number,street_full,locality,address",
      returnGeometry: "true",
    })
  );
  return (resp.features ?? []).flatMap((f) => {
    const a = f.attributes;
    const number = a?.street_number == null ? "" : String(a.street_number).trim();
    const road = String(a?.street_full ?? "").trim();
    const x = f.geometry?.x;
    const y = f.geometry?.y;
    if (!number || !road || x == null || y == null) return [];
    return [{ number, rest: [road, String(a?.locality ?? "").trim()].filter(Boolean).join(" "), full: String(a?.address ?? `${number} ${road}`), point: { lat: y, lng: x } }];
  });
}

// ── VIC: address points, "91A KINGSWAY GLEN WAVERLEY 3150" ─────────────────────────
interface VicResp {
  features?: {
    attributes?: {
      ezi_address?: string | null;
      house_number_1?: string | number | null;
      house_suffix_1?: string | null;
      house_number_2?: string | number | null;
      house_suffix_2?: string | null;
    };
    geometry?: { x?: number; y?: number };
  }[];
}

async function fetchVic(point: LatLng, halfWidthM: number): Promise<AddressFeature[]> {
  const resp = await fetchJson<VicResp>(
    VIC_URL,
    new URLSearchParams({
      ...envelopeParams(point, halfWidthM),
      outFields: "ezi_address,house_number_1,house_suffix_1,house_number_2,house_suffix_2",
      returnGeometry: "true",
    })
  );
  return (resp.features ?? []).flatMap((f) => {
    const a = f.attributes;
    const full = String(a?.ezi_address ?? "").trim();
    const n1 = a?.house_number_1 == null ? "" : `${a.house_number_1}${a.house_suffix_1 ?? ""}`.trim();
    const n2 = a?.house_number_2 == null ? "" : `${a.house_number_2}${a.house_suffix_2 ?? ""}`.trim();
    const x = f.geometry?.x;
    const y = f.geometry?.y;
    if (!full || !n1 || x == null || y == null) return [];
    const number = n2 ? `${n1}-${n2}` : n1;
    // ezi_address may open with a unit ("1/48 …"); the road is whatever follows the first
    // token that carries the house number.
    const idx = full.toUpperCase().indexOf(n1.toUpperCase());
    const afterNumber = idx >= 0 ? full.slice(idx + n1.length) : full;
    const rest = afterNumber.replace(/^\s*-\s*\S+/, "").replace(/\s+\d{4}$/, "").trim();
    return [{ number, rest, full, point: { lat: y, lng: x } }];
  });
}

const FETCHERS: Record<StandardMarkupState, (point: LatLng, halfWidthM: number) => Promise<AddressFeature[]>> = {
  NSW: fetchNsw,
  QLD: fetchQld,
  VIC: fetchVic,
};

/** Address features within `halfWidthM` of `point`. Empty on any failure — never throws. */
export async function fetchAddressFeaturesNear(
  state: StandardMarkupState,
  point: LatLng,
  halfWidthM: number
): Promise<AddressFeature[]> {
  try {
    return await FETCHERS[state](point, halfWidthM);
  } catch (e) {
    console.warn(`[address-features] ${state} lookup failed: ${(e as Error).message}`);
    return [];
  }
}
