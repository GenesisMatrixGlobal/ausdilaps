// "Detect lot boundary" — the cadastre lookup behind clicking a lot on the map.
//
// Deliberately not part of the address pipeline in ./resolve.ts: there is nothing to
// geocode here, and nothing to filter for adjacency. The operator has pointed at a lot,
// so the only question is which parcel contains that point.

import type { LatLng } from "@/lib/kml/types";
import { pointInRing } from "./geometry";
import { fetchParcelsNearPointNsw } from "./parcels/nsw";
import { fetchParcelsNearPointQld } from "./parcels/qld";
import type { ParcelFeature } from "./parcels/types";
import { fetchParcelsNearPointVic } from "./parcels/vic";
import type { StandardMarkupState } from "./resolve";

/** Small on purpose. An ArcGIS envelope query returns everything *intersecting* the box,
 *  so a wide one near a boundary hands back several parcels — the point-in-polygon test
 *  below is what actually picks the right one, and a tight box keeps the response small. */
const ENVELOPE_HALF_WIDTH_M = 15;

const PROVIDERS: Record<
  StandardMarkupState,
  (lng: number, lat: number, halfWidthM?: number) => Promise<ParcelFeature[]>
> = {
  QLD: fetchParcelsNearPointQld,
  NSW: fetchParcelsNearPointNsw,
  VIC: fetchParcelsNearPointVic,
};

/** The titled parcel containing `point`, or null when there isn't one — a road reserve,
 *  a park, unparcelled land, or a click just outside the cadastre's coverage. */
export async function parcelAtPoint(
  state: StandardMarkupState,
  point: LatLng
): Promise<ParcelFeature | null> {
  const candidates = await PROVIDERS[state](point.lng, point.lat, ENVELOPE_HALF_WIDTH_M);
  return candidates.find((c) => pointInRing(point, c.ring)) ?? null;
}
