// Properties → cadastre parcels, for the map.
//
// Free and keyless throughout: Salesforce supplies the coordinate, so there is no geocoding to
// pay for, and the state cadastres and address layers are open ArcGIS services the markup tools
// already read. A closeout markup costs nothing to generate — only the Static Maps tiles of the
// export are billed, exactly as on any other markup.

import { parcelAtPoint } from "@/lib/kml/standard-markup/parcel-at-point";
import { verifyParcelForAddress } from "@/lib/kml/standard-markup/parcels/verify-address";
import type { StandardMarkupState } from "@/lib/kml/standard-markup/resolve";
import type { LatLng } from "@/lib/kml/types";
import { mapPool } from "@/lib/util/map-pool";
import type { CloseoutProperty } from "./types";

/** The states with a cadastre adapter. Everywhere else the property is drawn as a pin — SA, WA
 *  and the ACT are ~18% of the work orders raised in the last two years, so this is a normal
 *  outcome rather than an edge case. */
const CADASTRE_STATES = new Set<string>(["QLD", "NSW", "VIC"]);

/** ArcGIS is free, but it is someone else's server. Same ceiling lookupParcels() uses. */
const CONCURRENCY = 5;

export interface ResolvedParcel {
  key: string;
  /** The title boundary, or null when the property could only be pinned. */
  ring: LatLng[] | null;
  areaSqm: number | null;
  lotPlan: string | null;
  /** Where the pin or the outline actually sits — the address layer's point when it corrected
   *  the geocode, else the work order's own. */
  point: LatLng;
  /** Why there is no ring, for the sheet. Null when there is one. */
  note: string | null;
}

/**
 * Find each property's parcel.
 *
 * ⚠️ The ADDRESS LAYER is tried first, not the coordinate. Salesforce routinely puts several
 * addresses on one point — eight High Street terraces at Barangaroo share a geocode — and a
 * cadastre lookup under that point hands all eight the same parcel. Asking the state address
 * layer for "3 High Street" by TEXT near the point separates them, and it is the same free
 * lookup Bulk Property Sizing already uses to catch a geocoder landing on the neighbour's lot.
 *
 * The coordinate is the fallback, and only for a precise geocode that the address layer had
 * nothing for. A suburb centroid is never given a parcel: it would return a real, convincing,
 * entirely unrelated lot.
 */
export async function resolveCloseoutParcels(properties: CloseoutProperty[]): Promise<ResolvedParcel[]> {
  return mapPool(properties, CONCURRENCY, async (p) => {
    const pin = (note: string): ResolvedParcel => ({
      key: p.key,
      ring: null,
      areaSqm: null,
      lotPlan: null,
      point: p.point,
      note,
    });

    if (!p.state || !CADASTRE_STATES.has(p.state)) {
      return pin(p.state ? `No cadastre for ${p.state} — shown as a pin` : "No state on the work order — shown as a pin");
    }
    const state = p.state as StandardMarkupState;

    // 1. By ADDRESS. Handles a shared point, a block-level geocode, and a geocode that simply
    //    landed on the wrong lot — all with one free call.
    if (p.suburb) {
      try {
        const verdict = await verifyParcelForAddress({
          state,
          street: p.street,
          suburb: p.suburb,
          geocodedPoint: p.point,
          // Null: we are not checking a parcel, we are asking the layer to find one. With no
          // ring to agree with, a match goes straight to the cadastre under the layer's point.
          parcelRing: null,
          parcelLabel: null,
        });
        if (verdict.outcome === "corrected") {
          return {
            key: p.key,
            ring: verdict.parcel.ring,
            areaSqm: verdict.areaSqm,
            lotPlan: verdict.parcel.idKey ?? null,
            point: verdict.point,
            note: null,
          };
        }
      } catch {
        // Never fatal. The address layer is a convenience; falling through to the coordinate
        // (or to a pin) is a worse answer, not a broken one.
      }
    }

    // 2. By COORDINATE — only where Salesforce located a building and only where this property
    //    has that point to itself.
    if (p.precision === "precise" && !p.sharedPoint) {
      try {
        const parcel = await parcelAtPoint(state, p.point);
        if (parcel && parcel.kind === "lot") {
          return {
            key: p.key,
            ring: parcel.ring,
            areaSqm: parcel.areaSqm,
            lotPlan: parcel.idKey ?? null,
            point: p.point,
            note: null,
          };
        }
        return pin("No titled parcel at this location — shown as a pin");
      } catch (e) {
        // ⚠️ An ArcGIS outage arrives as a 200 with an error body, which lib/arcgis.ts turns
        // into a throw precisely so it cannot be read as "there is nothing here". Say which it
        // was, rather than blaming the address.
        return pin(`Cadastre lookup failed — shown as a pin (${(e as Error).message})`);
      }
    }

    if (p.sharedPoint) return pin("Shares a location with another address — shown as a pin");
    if (p.precision === "area") return pin(`Located to the ${(p.accuracy ?? "area").toLowerCase()} only — shown as a pin`);
    return pin("Approximate location — shown as a pin");
  });
}

