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
}

/** One address per non-blank line, with the marker peeled off. Pure. */
export function parseBulkLines(text: string): BulkLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const withNeighbours = line.startsWith(WITH_NEIGHBOURS_MARKER);
      const bare = withNeighbours ? line.slice(WITH_NEIGHBOURS_MARKER.length).trim() : line;
      const [addr] = parseAddressBlock(bare);
      return addr ? [{ addr, withNeighbours }] : [];
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
}

export interface BulkParcelsResult {
  parcels: BulkParcel[];
  /** The job's address block: the first resolved address, for filenames and the save file. */
  address: { street: string; suburb: string; postcode: string; state: string };
  /** Addresses that produced no parcel, with why — shown as flags, never silently dropped. */
  unresolved: { raw: string; reason: string }[];
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

export async function resolveBulkParcels(text: string): Promise<BulkParcelsResult> {
  const lines = parseBulkLines(text);
  const addresses = lines.map((l) => l.addr);
  if (addresses.length === 0) throw new Error("No addresses found — one per line, straight from Excel.");
  if (addresses.length > MAX_BULK_ADDRESSES) {
    throw new Error(`That's ${addresses.length} addresses — the markup takes up to ${MAX_BULK_ADDRESSES} at once.`);
  }

  const looked = await lookupParcels(addresses);
  const parcels: BulkParcel[] = [];
  const unresolved: BulkParcelsResult["unresolved"] = [];
  const used = new Set<string>();
  const expansionFlags: string[] = [];

  looked.forEach(({ addr, result, parcelRings }, i) => {
    const ring = latLngRingFromArcgis(parcelRings);
    if (result.status !== "ok" || !ring) {
      unresolved.push({
        raw: addr.raw,
        reason: result.flags[0] ?? (result.status === "ok" ? "no parcel geometry returned" : result.status.replace("_", " ")),
      });
      return;
    }
    // A lot/plan when the cadastre gave one, else the `n<index>` placeholder that parcel-id.ts
    // knows NOT to print as a lot/plan.
    const base = result.lotPlan ?? `n${i}`;
    parcels.push({
      id: uniqueId(base, used),
      ring,
      areaSqm: result.lotSizeSqm,
      street: displayStreet(addr),
      suburb: addr.suburb || null,
    });
  });

  // Marked addresses: their adjoining lots join the markup too. After the listed parcels, so a
  // neighbour that is ALSO a listed address keeps the listed row and is not added twice.
  const marked = looked
    .map((l, i) => ({ ...l, withNeighbours: lines[i].withNeighbours }))
    .filter((l) => l.withNeighbours && l.result.status === "ok" && l.point && l.addr.state && l.addr.state in NEAR_POINT);
  const expansions = await mapPool(marked, 3, async (l) => ({
    l,
    ...(await adjoiningLots(l.addr.state as StandardMarkupState, l.point!, { street: l.addr.street, suburb: l.addr.suburb })),
  }));
  for (const { l, lots, error } of expansions) {
    const label = displayStreet(l.addr);
    if (error) {
      expansionFlags.push(`${label}: couldn't look up the adjoining lots — ${error}`);
      continue;
    }
    let added = 0;
    for (const lot of lots) {
      const base = lot.idKey || `n${parcels.length}`;
      if (used.has(base)) continue; // already on the markup in its own right
      parcels.push({ id: uniqueId(base, used), ring: lot.ring, areaSqm: lot.areaSqm, street: lot.street, suburb: lot.suburb });
      added++;
    }
    expansionFlags.push(`${label}: ${added} adjoining lot${added === 1 ? "" : "s"} added`);
  }

  if (parcels.length === 0) {
    throw new Error(
      `None of the ${addresses.length} addresses resolved to a parcel: ${unresolved
        .slice(0, 3)
        .map((u) => `${u.raw} (${u.reason})`)
        .join("; ")}${unresolved.length > 3 ? "…" : ""}`
    );
  }

  const first = looked.find((l) => l.result.status === "ok")?.addr ?? addresses[0];
  const flags = unresolved.map((u) => `${u.raw}: ${u.reason} — not on the markup`);
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
  for (const l of looked) {
    if (l.result.status === "ok") for (const f of l.result.flags) flags.push(`${displayStreet(l.addr)}: ${f}`);
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
    flags,
  };
}
