// Per-lot street addresses for the Building Markup's Quote Line Item sheet.
//
// Every state publishes an address layer on the SAME free, keyless ArcGIS service the parcel
// adapters already query for lots — so this costs no API key and no Google quota. QLD's layer
// carries `lotplan`, so it joins on the id the tool already has; NSW and VIC have no lot id, so
// they join spatially against the rings.
//
// ⚠ THIS MODULE MUST NEVER THROW. The parcel adapters throw on failure and that is correct —
// without a boundary there is no markup. An address is a convenience: a failed lookup returns
// an empty map, the cells come up blank, and the operator types them. Same rule as the
// knowledge base's vision pass.

import { assertNoArcgisError } from "@/lib/arcgis";
import type { LatLng } from "@/lib/kml/types";
import { centroidOf, envelopeOfRings, pointInRing } from "../geometry";
import type { StandardMarkupState } from "../resolve";
import { describeFetchError } from "./describe-fetch-error";

const QLD_ADDRESS_URL =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/0/query";
const NSW_ADDRESS_URL = "https://maps.six.nsw.gov.au/arcgis/rest/services/sixmaps/Boundaries/MapServer/8/query";
const VIC_ADDRESS_URL =
  "https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Address/FeatureServer/0/query";

/** Padding on the bounding box of the lot rings. Generous because an address point sits at a
 *  building, which can be well inside a deep lot — and because over-fetching here is free
 *  (one call, a few dozen rows) while under-fetching silently loses a lot's address. */
const ENVELOPE_PAD_M = 40;

const TIMEOUT_MS = 12000;

export interface LotAddress {
  /** Street number and street name, e.g. "355 Maundrell Terrace". Title-cased. */
  street: string;
  suburb: string;
  /** How many OTHER addresses the source held for this lot. Non-zero means a multi-frontage
   *  corner lot or a strata block, i.e. the one shown is a pick — see the flags. */
  alternatives: number;
}

export interface LotAddressResult {
  /** Keyed on the parcel's own idKey, BEFORE resolve.ts suffixes duplicates with "#2". */
  byIdKey: Map<string, LotAddress>;
  flags: string[];
}

const EMPTY: LotAddressResult = { byIdKey: new Map(), flags: [] };

interface Lot {
  idKey: string;
  ring: LatLng[];
}

async function fetchJson<T>(url: string, params: URLSearchParams): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}?${params.toString()}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    // An ArcGIS failure is HTTP 200 with an `error` body — see lib/arcgis.ts. Thrown here and
    // caught by fetchLotAddresses, so the log says the service broke instead of reporting a
    // confident "0 addresses". The markup is unaffected either way.
    assertNoArcgisError(body, "The address layer");
    return body as T;
  } finally {
    clearTimeout(t);
  }
}

/** NSW returns SHOUTED addresses; QLD's locality is upper case too. Handles the hyphenated
 *  and apostrophe cases ("O'CONNELL", "STRATH-CREEK") that a naive per-word rule mangles.
 *
 *  Then re-uppercases a unit-suffix letter glued to a street number — "353A", "25A" — which
 *  the pass above had turned into "353a". Deliberately narrow: it only fires on a LONE letter
 *  directly after digits at the start of a word, so "1st Avenue" is left alone. */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[\s\-'/])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/(^|\s)(\d+)([a-z])(?=\s|$|-|\/)/g, (_, sep: string, num: string, ch: string) =>
      sep + num + ch.toUpperCase()
    );
}

/** The road name out of a full street line: "12 Albany Creek Road" -> "albany creek road".
 *  Used only to compare frontages, so it is lower-cased and stripped of the number. */
function roadNameOf(street: string): string {
  return street
    .toLowerCase()
    .replace(/^\s*\d+[a-z]?\s*(-\s*\d+[a-z]?\s*)?/, "")
    .trim();
}

/**
 * Splits a single formatted address string into street + suburb.
 *
 * NSW hands back one glued string ("60 OLD NORTHERN ROAD BAULKHAM HILLS") and VIC one with the
 * postcode on the end ("91A KINGSWAY GLEN WAVERLEY 3150"). Rather than guessing where the
 * street ends, this strips a KNOWN tail — the suburb and postcode are already established, by
 * the geocode or by the layer's own fields — which is the only version of this that can't cut
 * a two-word street name in half.
 *
 * If the tail isn't there (a neighbour genuinely in the next suburb), the whole string stays in
 * `street`. That is visibly wrong in one editable cell, which beats a confidently mis-split one.
 */
function splitAddress(full: string, suburb: string, postcode?: string): { street: string; suburb: string } {
  let rest = full.trim();
  if (postcode) {
    const p = new RegExp(`\\s*${postcode}\\s*$`, "i");
    rest = rest.replace(p, "");
  }
  const s = new RegExp(`\\s*${suburb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const stripped = rest.replace(s, "");
  return { street: titleCase(stripped.trim()), suburb: titleCase(suburb) };
}

// ── QLD: attribute join on lotplan ────────────────────────────────────────────────────

interface QldResp {
  features?: {
    attributes?: {
      lotplan?: string;
      street_number?: string | number | null;
      street_full?: string | null;
      locality?: string | null;
    };
  }[];
}

async function fetchQld(lots: Lot[], subjectStreet: string): Promise<LotAddressResult> {
  // Belt-and-braces on the `IN` list even though a lotplan is cadastre-issued and
  // alphanumeric: it is going into a where clause, so anything else is dropped rather than
  // quoted.
  const keys = lots.map((l) => l.idKey).filter((k) => /^[A-Za-z0-9]+$/.test(k));
  if (keys.length === 0) return EMPTY;

  const resp = await fetchJson<QldResp>(
    QLD_ADDRESS_URL,
    new URLSearchParams({
      where: `lotplan IN (${keys.map((k) => `'${k}'`).join(",")})`,
      outFields: "lotplan,street_number,street_full,locality",
      returnGeometry: "false",
      f: "json",
    })
  );

  // One lotplan can hold several addresses, and NOT only for strata: 15RP815277 at Aspley is a
  // corner lot addressed off four different streets. There is no primary-address flag on this
  // layer, so a pick is unavoidable — make it deterministic and say how many were passed over.
  const grouped = new Map<string, { street: string; suburb: string }[]>();
  for (const f of resp.features ?? []) {
    const a = f.attributes;
    const lotplan = String(a?.lotplan ?? "");
    const road = String(a?.street_full ?? "").trim();
    if (!lotplan || !road) continue;
    // A string, deliberately: "353A" is a real street number and Number() would eat the A.
    const number = a?.street_number == null ? "" : String(a.street_number).trim();
    const list = grouped.get(lotplan) ?? [];
    list.push({
      // The number is kept VERBATIM — the cadastre already publishes it as "353A", and
      // title-casing a field that is handed over correctly can only damage it. Only the road
      // name and locality, which QLD shouts, go through titleCase.
      street: [number, titleCase(road)].filter(Boolean).join(" "),
      suburb: titleCase(String(a?.locality ?? "").trim()),
    });
    grouped.set(lotplan, list);
  }

  const wanted = roadNameOf(subjectStreet);
  const byIdKey = new Map<string, LotAddress>();
  const flags: string[] = [];
  for (const [lotplan, list] of grouped) {
    // Prefer the frontage on the same road as the job's own address — an adjoining lot on the
    // subject's street is the one the inspection is about. Otherwise take the lowest street
    // number, purely so the same lot always resolves the same way.
    const sorted = [...list].sort((a, b) => {
      const aMatch = roadNameOf(a.street) === wanted ? 0 : 1;
      const bMatch = roadNameOf(b.street) === wanted ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return a.street.localeCompare(b.street, undefined, { numeric: true });
    });
    byIdKey.set(lotplan, { ...sorted[0], alternatives: list.length - 1 });
    if (list.length > 1) {
      flags.push(
        `${lotplan} has ${list.length} addresses (${list.map((a) => a.street).join(", ")}) — using ${sorted[0].street}`
      );
    }
  }
  return { byIdKey, flags };
}

// ── NSW: spatial join, polygon address layer ──────────────────────────────────────────

interface NswResp {
  features?: {
    attributes?: { address?: string | null };
    geometry?: { rings?: number[][][] };
  }[];
}

async function fetchNsw(lots: Lot[], suburb: string): Promise<LotAddressResult> {
  const env = envelopeOfRings(lots.map((l) => l.ring), ENVELOPE_PAD_M);
  if (!env) return EMPTY;

  const resp = await fetchJson<NswResp>(
    NSW_ADDRESS_URL,
    new URLSearchParams({
      // FOUR coordinates, always. An envelope given two is silently accepted and answered with
      // an arbitrary page of addresses from elsewhere in the state — no error, just wrong data.
      geometry: `${env.xmin},${env.ymin},${env.xmax},${env.ymax}`,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      // Load-bearing, not a nicety: without it one suburban block returns 189 features (every
      // unit in every strata block) instead of 5 properties.
      where: "principaladdresstype=1",
      outFields: "address",
      returnGeometry: "true",
      outSR: "4326",
      f: "json",
    })
  );

  const polygons = (resp.features ?? [])
    .map((f) => ({
      address: String(f.attributes?.address ?? "").trim(),
      ring: (f.geometry?.rings?.[0] ?? []).map(([lng, lat]) => ({ lat, lng })),
    }))
    .filter((p) => p.address && p.ring.length >= 3);

  const byIdKey = new Map<string, LotAddress>();
  for (const lot of lots) {
    if (lot.ring.length < 3) continue;
    // The lot's centroid inside the address polygon, rather than the reverse: an NSW property
    // can span several lots, and this way every one of them inherits the property's address
    // instead of only whichever lot happens to contain the property centroid.
    const hits = polygons.filter((p) => pointInRing(centroidOf(lot.ring), p.ring));
    if (hits.length === 0) continue;
    byIdKey.set(lot.idKey, { ...splitAddress(hits[0].address, suburb), alternatives: hits.length - 1 });
  }
  return { byIdKey, flags: [] };
}

// ── VIC: spatial join, point address layer ────────────────────────────────────────────

interface VicResp {
  features?: {
    attributes?: {
      ezi_address?: string | null;
      locality_name?: string | null;
      postcode?: string | number | null;
      property_pfi?: string | number | null;
    };
    geometry?: { x?: number; y?: number };
  }[];
}

async function fetchVic(lots: Lot[]): Promise<LotAddressResult> {
  const env = envelopeOfRings(lots.map((l) => l.ring), ENVELOPE_PAD_M);
  if (!env) return EMPTY;

  const resp = await fetchJson<VicResp>(
    VIC_ADDRESS_URL,
    new URLSearchParams({
      geometry: `${env.xmin},${env.ymin},${env.xmax},${env.ymax}`,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "ezi_address,locality_name,postcode,property_pfi",
      returnGeometry: "true",
      outSR: "4326",
      f: "json",
    })
  );

  const points = (resp.features ?? [])
    .map((f) => ({
      // ezi_address whole, never reassembled from the parts: road_type is null for some roads
      // (KINGSWAY), and house_number_1 is an integer so it drops the A in "91A".
      full: String(f.attributes?.ezi_address ?? "").trim(),
      locality: String(f.attributes?.locality_name ?? "").trim(),
      postcode: f.attributes?.postcode == null ? "" : String(f.attributes.postcode).trim(),
      propertyPfi: String(f.attributes?.property_pfi ?? ""),
      point: { lat: f.geometry?.y ?? NaN, lng: f.geometry?.x ?? NaN },
    }))
    .filter((p) => p.full && Number.isFinite(p.point.lat) && Number.isFinite(p.point.lng));

  const byIdKey = new Map<string, LotAddress>();
  for (const lot of lots) {
    if (lot.ring.length < 3) continue;
    const inside = points.filter((p) => pointInRing(p.point, lot.ring));
    if (inside.length === 0) continue;
    // Deduped by property_pfi, NOT by is_primary — that flag reads "Y" on unit rows too, so
    // filtering on it leaves the whole strata block behind.
    const distinct = new Map(inside.map((p) => [p.propertyPfi, p]));
    const chosen = [...distinct.values()].sort((a, b) =>
      a.full.localeCompare(b.full, undefined, { numeric: true })
    )[0];
    byIdKey.set(lot.idKey, {
      ...splitAddress(chosen.full, chosen.locality, chosen.postcode),
      alternatives: distinct.size - 1,
    });
  }
  return { byIdKey, flags: [] };
}

/**
 * Flags lots that resolved to the SAME address — two cadastral lots of one property.
 *
 * Seen live in Glen Waverley: 1/PS407132 and 2/PS407132 both land on 2/289 Springvale Road,
 * because a strata lot and its common property overlap. Both rows are correct, and quoting
 * both as separate properties would bill the same building twice — which is a decision for
 * the estimator, so it gets said out loud rather than deduplicated here.
 */
function sharedAddressFlags(byIdKey: Map<string, LotAddress>): string[] {
  const byAddress = new Map<string, string[]>();
  for (const [idKey, a] of byIdKey) {
    const full = `${a.street}, ${a.suburb}`;
    byAddress.set(full, [...(byAddress.get(full) ?? []), idKey]);
  }
  return [...byAddress]
    .filter(([, ids]) => ids.length > 1)
    .map(([full, ids]) => `${ids.join(" and ")} share the address ${full} — probably one property, not ${ids.length}`);
}

/**
 * Street + suburb for each lot, best effort.
 *
 * Returns an empty map on any failure — never throws, never a reason for a markup to fail.
 */
export async function fetchLotAddresses(
  state: StandardMarkupState,
  lots: Lot[],
  ctx: { street: string; suburb: string }
): Promise<LotAddressResult> {
  if (lots.length === 0) return EMPTY;
  const start = Date.now();
  try {
    const result = await (state === "QLD"
      ? fetchQld(lots, ctx.street)
      : state === "NSW"
        ? fetchNsw(lots, ctx.suburb)
        : fetchVic(lots));
    return { ...result, flags: [...result.flags, ...sharedAddressFlags(result.byIdKey)] };
  } catch (e) {
    // Logged, not surfaced. A blank address cell the operator fills in is a smaller problem
    // than a banner about a lookup they didn't ask for.
    console.warn(`[standard-markup] ${state} address lookup ${describeFetchError(e, Date.now() - start)}`);
    return EMPTY;
  }
}
