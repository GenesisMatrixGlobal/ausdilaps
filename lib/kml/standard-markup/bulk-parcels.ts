// Many addresses → many parcels, for the multi-property markup on Markup and Measure's *DEV*
// tab.
//
// Building Markup proper finds lots by ADJACENCY: one geocoded site, then whatever the cadastre
// says touches it within 4 m (./neighbours.ts). A street survey of 30 houses is not that — the
// houses are 30 independent subjects with their own addresses — so this resolves each address
// on its own through the same per-address pipeline Bulk Property Sizing uses (geocode → point-
// in-polygon → parcel), and hands back the parcels in the shape the markup already stores its
// lots in. Nothing downstream — the map, the sheet, the export, the save file — knows the
// difference between a detected neighbour and a pasted property.

import type { LatLng } from "@/lib/kml/types";
import { parseAddressBlock } from "@/lib/property-sizing/parse";
import type { ParsedAddress } from "@/lib/property-sizing/types";
import { displayStreet, lookupParcels } from "@/lib/property-sizing";
import { latLngRingFromArcgis } from "@/lib/property-sizing/rings";
import { mapPool } from "@/lib/util/map-pool";
import { identifySubjectAndNeighbours } from "./neighbours";
import { fetchLotAddresses } from "./parcels/addresses";
import { fetchParcelsNearPointNsw } from "./parcels/nsw";
import { fetchParcelsNearPointQld } from "./parcels/qld";
import { fetchParcelsNearPointVic } from "./parcels/vic";
import type { ParcelFeature } from "./parcels/types";
import { parcelAtPoint } from "./parcel-at-point";
import type { StandardMarkupState } from "./resolve";

/** More than this on one drawing stops being a markup and starts being a map. */
export const MAX_BULK_ADDRESSES = 60;

/**
 * A line starting with `+` also pulls in the lots ADJOINING that address — the same 4 m
 * adjacency rule Building Markup uses for its "Detected lots". The DEV tab's address search
 * writes the marker when its "Pre-select surrounding assets" toggle is on; a pasted list never
 * carries it. Two kinds of quote from one paste box: a job site with its neighbours, or a
 * street survey of listed properties.
 */
export const WITH_NEIGHBOURS_MARKER = "+";

export interface BulkLine {
  addr: ParsedAddress;
  withNeighbours: boolean;
  /** Set when the line opened with a coordinate pair — a place Google has no street address for
   *  (a community centre, a reserve, a corner). Resolved by the parcel UNDER the point rather
   *  than by geocoding the text; with no titled parcel there, the map is simply centred on it. */
  point?: LatLng;
}

/** `-33.770034, 151.037490 The Don Moore Community Centre, Carlingford NSW 2118` — a coordinate,
 *  then whatever label the search box had for the place. Both numbers must carry decimals: a
 *  house number never does, so "12, 151 Smith St" can't be read as latitude 12. */
const COORDINATE_LINE_RE = /^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*(.*)$/;

function coordinateLine(bare: string, withNeighbours: boolean): BulkLine | null {
  const m = COORDINATE_LINE_RE.exec(bare);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180) || (lat === 0 && lng === 0)) return null;
  // The label parses like any address line, so a suburb and state ride along (the state picks
  // the cadastre). The place name lands in `street`, which is what the sheet row wants to say.
  const label = m[3].trim();
  const [labelAddr] = label ? parseAddressBlock(label) : [];
  const addr: ParsedAddress = labelAddr ? { ...labelAddr, raw: bare } : { raw: bare, street: "", suburb: "" };
  return { addr, withNeighbours, point: { lat, lng } };
}

/** One address per non-blank line, with the marker peeled off. Pure.
 *
 *  A line with no state and no postcode ("13 Craig Ave Vaucluse" in a list where the others
 *  say NSW) takes the state of the nearest line that has one — a pasted list is one job, and a
 *  job is in one state. Only when NOTHING in the list says a state does the line stay unknown. */
export function parseBulkLines(text: string): BulkLine[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const withNeighbours = line.startsWith(WITH_NEIGHBOURS_MARKER);
      const bare = withNeighbours ? line.slice(WITH_NEIGHBOURS_MARKER.length).trim() : line;
      const coord = coordinateLine(bare, withNeighbours);
      if (coord) return [coord];
      const [addr] = parseAddressBlock(bare);
      return addr ? [{ addr, withNeighbours }] : [];
    });
  const known = lines.map((l) => l.addr.state);
  return lines.map((l, i) => {
    if (l.addr.state) return l;
    const before = known.slice(0, i).reverse().find(Boolean);
    const after = known.slice(i + 1).find(Boolean);
    const inherited = before ?? after;
    return inherited ? { ...l, addr: { ...l.addr, state: inherited } } : l;
  });
}

const NEAR_POINT: Record<StandardMarkupState, (lng: number, lat: number) => Promise<ParcelFeature[]>> = {
  QLD: (lng, lat) => fetchParcelsNearPointQld(lng, lat),
  NSW: (lng, lat) => fetchParcelsNearPointNsw(lng, lat),
  VIC: (lng, lat) => fetchParcelsNearPointVic(lng, lat),
};

/** The titled lots adjoining the parcel at `point`, with their street addresses. Never
 *  throws — a failed expansion is a flag, not a lost markup. */
async function adjoiningLots(
  state: StandardMarkupState,
  point: LatLng,
  ctx: { street: string; suburb: string }
): Promise<{ lots: { idKey: string; ring: LatLng[]; areaSqm: number | null; street: string | null; suburb: string | null }[]; error?: string }> {
  try {
    const candidates = await NEAR_POINT[state](point.lng, point.lat);
    const found = identifySubjectAndNeighbours(point, candidates);
    if (!found) return { lots: [] };
    const addresses = await fetchLotAddresses(
      state,
      found.neighbours.map((n) => ({ idKey: n.idKey, ring: n.ring })),
      ctx
    );
    return {
      lots: found.neighbours.map((n) => {
        const a = addresses.byIdKey.get(n.idKey);
        return { idKey: n.idKey, ring: n.ring, areaSqm: n.areaSqm, street: a?.street ?? null, suburb: a?.suburb ?? null };
      }),
    };
  } catch (e) {
    return { lots: [], error: (e as Error).message };
  }
}

export interface BulkParcel {
  id: string;
  ring: LatLng[];
  areaSqm: number | null;
  street: string | null;
  suburb: string | null;
  /** Red for a `+` address — the one the quote is about, drawn the way Building Markup draws its
   *  site. Blue for a listed property and for every adjoining lot. */
  color: "red" | "blue";
}

export interface BulkParcelsResult {
  parcels: BulkParcel[];
  /** The job's address block: the first resolved address, for filenames and the save file. */
  address: { street: string; suburb: string; postcode: string; state: string };
  /** Addresses that produced no parcel, with why — shown as flags, never silently dropped. */
  unresolved: { raw: string; reason: string }[];
  /** Coordinate lines with no titled parcel under them. Not a failure: the map is centred
   *  there and the operator draws the site by hand. */
  centres: { point: LatLng; label: string }[];
  flags: string[];
}

/** Ids key the exclude-set and the sheet rows, so two units on one strata lot must not collapse
 *  into one toggle — same `#2` suffix rule the resolver and the map picker use. */
function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let dup = 2; used.has(id); dup++) id = `${base}#${dup}`;
  used.add(id);
  return id;
}

/** One line, resolved — whichever way it came in. The address pipeline and the point lookup
 *  both land here so everything after (parcels, `+` expansion, flags) is one path. */
interface ResolvedLine {
  line: BulkLine;
  ring: LatLng[] | null;
  lotPlan: string | null;
  areaSqm: number | null;
  /** The verified point — after any address-layer correction — for the adjoining-lot search. */
  point: LatLng | null;
  notes: string[];
  /** Why there is no parcel. Null when there is one, or when the line is a plain centre. */
  failure: string | null;
}

/** A coordinate line: the titled parcel under the point, or nothing. A road reserve or an
 *  easement counts as nothing — drawing a whole road because a place pin sits on it is worse
 *  than an empty map. Never throws: a cadastre outage here is a centre, not a lost markup. */
async function lookupPoint(line: BulkLine): Promise<ResolvedLine> {
  const point = line.point!;
  const state = line.addr.state;
  const base: ResolvedLine = { line, ring: null, lotPlan: null, areaSqm: null, point, notes: [], failure: null };
  if (!state || !(state in NEAR_POINT)) return base;
  try {
    const parcel = await parcelAtPoint(state as StandardMarkupState, point);
    if (!parcel || parcel.kind !== "lot") return base;
    return { ...base, ring: parcel.ring, lotPlan: parcel.idKey || null, areaSqm: parcel.areaSqm };
  } catch (e) {
    return { ...base, notes: [`couldn't read the cadastre at that point — ${(e as Error).message}`] };
  }
}

export async function resolveBulkParcels(text: string): Promise<BulkParcelsResult> {
  const lines = parseBulkLines(text);
  const addresses = lines.map((l) => l.addr);
  if (addresses.length === 0) throw new Error("No addresses found — one per line, straight from Excel.");
  if (addresses.length > MAX_BULK_ADDRESSES) {
    throw new Error(`That's ${addresses.length} addresses — the markup takes up to ${MAX_BULK_ADDRESSES} at once.`);
  }

  // Address lines go through the geocode → parcel pipeline; coordinate lines skip the geocoder
  // (there is no address to geocode) and take the parcel under the point. Both run at once and
  // are stitched back into list order, so line i is still lines[i] downstream.
  const [byAddress, byPoint] = await Promise.all([
    lookupParcels(lines.filter((l) => !l.point).map((l) => l.addr)),
    mapPool(lines.filter((l) => l.point), 5, lookupPoint),
  ]);
  let ai = 0;
  let pi = 0;
  const resolved: ResolvedLine[] = lines.map((line) => {
    if (line.point) return byPoint[pi++];
    const { result, parcelRings, point } = byAddress[ai++];
    const ring = latLngRingFromArcgis(parcelRings);
    const ok = result.status === "ok" && !!ring;
    return {
      line,
      ring: ok ? ring : null,
      lotPlan: result.lotPlan,
      areaSqm: result.lotSizeSqm,
      point,
      notes: ok ? result.flags : [],
      failure: ok
        ? null
        : result.flags[0] ?? (result.status === "ok" ? "no parcel geometry returned" : result.status.replace("_", " ")),
    };
  });

  const parcels: BulkParcel[] = [];
  const unresolved: BulkParcelsResult["unresolved"] = [];
  const centres: BulkParcelsResult["centres"] = [];
  const used = new Set<string>();
  const expansionFlags: string[] = [];

  resolved.forEach((r, i) => {
    const { addr } = r.line;
    if (!r.ring) {
      if (r.line.point) centres.push({ point: r.line.point, label: displayStreet(addr) || addr.raw });
      else unresolved.push({ raw: addr.raw, reason: r.failure ?? "no parcel" });
      return;
    }
    // A lot/plan when the cadastre gave one, else the `n<index>` placeholder that parcel-id.ts
    // knows NOT to print as a lot/plan.
    const base = r.lotPlan ?? `n${i}`;
    parcels.push({
      id: uniqueId(base, used),
      ring: r.ring,
      areaSqm: r.areaSqm,
      street: displayStreet(addr) || null,
      suburb: addr.suburb || null,
      color: r.line.withNeighbours ? "red" : "blue",
    });
  });

  // Marked addresses: their adjoining lots join the markup too. After the listed parcels, so a
  // neighbour that is ALSO a listed address keeps the listed row and is not added twice.
  const marked = resolved.filter(
    (r) => r.line.withNeighbours && r.ring && r.point && r.line.addr.state && r.line.addr.state in NEAR_POINT
  );
  const expansions = await mapPool(marked, 3, async (r) => ({
    r,
    ...(await adjoiningLots(r.line.addr.state as StandardMarkupState, r.point!, {
      street: r.line.addr.street,
      suburb: r.line.addr.suburb,
    })),
  }));
  for (const { r, lots, error } of expansions) {
    const label = displayStreet(r.line.addr);
    if (error) {
      expansionFlags.push(`${label}: couldn't look up the adjoining lots — ${error}`);
      continue;
    }
    let added = 0;
    for (const lot of lots) {
      const base = lot.idKey || `n${parcels.length}`;
      if (used.has(base)) continue; // already on the markup in its own right
      parcels.push({ id: uniqueId(base, used), ring: lot.ring, areaSqm: lot.areaSqm, street: lot.street, suburb: lot.suburb, color: "blue" });
      added++;
    }
    expansionFlags.push(`${label}: ${added} adjoining lot${added === 1 ? "" : "s"} added`);
  }

  if (parcels.length === 0 && centres.length === 0) {
    throw new Error(
      `None of the ${addresses.length} addresses resolved to a parcel: ${unresolved
        .slice(0, 3)
        .map((u) => `${u.raw} (${u.reason})`)
        .join("; ")}${unresolved.length > 3 ? "…" : ""}`
    );
  }

  const first = resolved.find((r) => r.ring)?.line.addr ?? addresses[0];
  const flags = unresolved.map((u) => `${u.raw}: ${u.reason} — not on the markup`);
  for (const c of centres) flags.push(`${c.label}: no titled parcel at that point — the map is centred there, draw the site by hand`);
  // Two addresses on ONE lot draw one outline with two pins stacked on it — a strata pair, or
  // a geocode the address layer couldn't correct. Said out loud, because the second pin is
  // invisible under the first.
  const byLot = new Map<string, string[]>();
  for (const p of parcels) {
    const base = p.id.replace(/#\d+$/, "");
    byLot.set(base, [...(byLot.get(base) ?? []), p.street ?? p.id]);
  }
  for (const [lot, streets] of byLot) {
    if (streets.length > 1) flags.push(`${streets.join(" and ")} are on the same lot (${lot}) — one outline, pins stacked`);
  }
  // Per-address notes from the lookup (address-layer corrections and the like).
  for (const r of resolved) {
    for (const f of r.notes) flags.push(`${displayStreet(r.line.addr) || r.line.addr.raw}: ${f}`);
  }
  flags.push(...expansionFlags);
  const states = new Set(addresses.map((a) => a.state).filter(Boolean));
  if (states.size > 1) flags.push(`Addresses span ${[...states].join(", ")} — the map's state controls follow the first`);

  return {
    parcels,
    address: {
      street: displayStreet(first),
      suburb: first.suburb,
      postcode: first.postcode ?? "",
      state: first.state ?? "",
    },
    unresolved,
    centres,
    flags,
  };
}
