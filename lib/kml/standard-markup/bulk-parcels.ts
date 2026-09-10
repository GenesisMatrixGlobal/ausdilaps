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
import { displayStreet, lookupParcels } from "@/lib/property-sizing";

/** More than this on one drawing stops being a markup and starts being a map. */
export const MAX_BULK_ADDRESSES = 60;

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

/** ArcGIS ring (`[x, y]` = `[lng, lat]`, outer ring first, usually closed) → the markup's LatLng
 *  ring, unclosed — closeRing() is applied wherever a closed ring is needed. */
function ringFromArcgis(rings: number[][][] | undefined): LatLng[] | null {
  const outer = rings?.[0];
  if (!outer || outer.length < 3) return null;
  const pts = outer.map(([x, y]) => ({ lat: y, lng: x }));
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length > 3 && first.lat === last.lat && first.lng === last.lng) pts.pop();
  return pts.length >= 3 ? pts : null;
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
  const addresses = parseAddressBlock(text);
  if (addresses.length === 0) throw new Error("No addresses found — one per line, straight from Excel.");
  if (addresses.length > MAX_BULK_ADDRESSES) {
    throw new Error(`That's ${addresses.length} addresses — the markup takes up to ${MAX_BULK_ADDRESSES} at once.`);
  }

  const looked = await lookupParcels(addresses);
  const parcels: BulkParcel[] = [];
  const unresolved: BulkParcelsResult["unresolved"] = [];
  const used = new Set<string>();

  looked.forEach(({ addr, result, parcelRings }, i) => {
    const ring = ringFromArcgis(parcelRings);
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
