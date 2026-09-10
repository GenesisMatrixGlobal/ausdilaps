// Did the geocoder land on the RIGHT parcel? Ask the state address layer.
//
// Seen live at Vaucluse / Dover Heights (2026-09-10): Google put 42 and 44 Eastern Ave on one
// point, and 12 and 13 Craig Ave on one point — 13 is across the road from 12. Every one of
// those geocodes was typed `street_address` / ROOFTOP, so the precision gate let them through,
// the cadastre returned the parcel under the point, and Bulk Property Sizing reported the
// neighbour's lot size with a straight face. The address layer knows which property is No. 44,
// so: find the requested address by text near the geocoded point, and if it sits on a
// different parcel, that parcel is the answer.
//
// Never throws. Any failure leaves the geocoded parcel in place, marked unverified.

import type { LatLng } from "@/lib/kml/types";
import { pointInRing, ringAreaSqm } from "../geometry";
import { ringAnchor } from "../measure";
import { parcelAtPoint } from "../parcel-at-point";
import type { StandardMarkupState } from "../resolve";
import { fetchAddressFeaturesNear } from "./address-features";
import { findAddressFeature } from "./address-match";
import type { ParcelFeature } from "./types";

/** How far from the geocoded point the real address may be. 13 Craig Ave is ~40 m from where
 *  Google put it (12's lot across the road); an interpolated position on a long street can be a
 *  few lots out. 200 m covers that and stays well inside the layers' record caps. */
const SEARCH_HALF_WIDTH_M = 200;

export type VerifyOutcome =
  /** The address layer agrees: its point for this address is inside the geocoded parcel. */
  | { outcome: "verified" }
  /** The address is a different parcel. Everything a caller needs to swap it in. */
  | { outcome: "corrected"; parcel: ParcelFeature; areaSqm: number; point: LatLng; note: string }
  /** Couldn't tell. The geocoded parcel stands; `note` says why. */
  | { outcome: "unverified"; note: string };

export async function verifyParcelForAddress(input: {
  state: StandardMarkupState;
  street: string;
  suburb: string;
  geocodedPoint: LatLng;
  /** The parcel the geocode landed in, as the cadastre returned it. Null when there was none. */
  parcelRing: LatLng[] | null;
  /** For the note only. */
  parcelLabel: string | null;
}): Promise<VerifyOutcome> {
  const features = await fetchAddressFeaturesNear(input.state, input.geocodedPoint, SEARCH_HALF_WIDTH_M);
  if (features.length === 0) {
    return { outcome: "unverified", note: `${input.state} address layer returned nothing nearby — geocode unverified` };
  }
  const match = findAddressFeature(features, { street: input.street, suburb: input.suburb });
  if (!match) {
    return { outcome: "unverified", note: `not found in the ${input.state} address layer within ${SEARCH_HALF_WIDTH_M} m — geocode unverified` };
  }
  if (input.parcelRing && input.parcelRing.length >= 3) {
    // Agreement either way round: the address layer's point is inside the geocoded parcel, or
    // (NSW, where the layer hands over the whole property polygon) the geocoded parcel sits
    // inside the property — a property can span several lots, and any of them is "at" the
    // address.
    if (pointInRing(match.point, input.parcelRing)) return { outcome: "verified" };
    const parcelAnchor = ringAnchor(input.parcelRing);
    if (match.ring && parcelAnchor && pointInRing(parcelAnchor, match.ring)) return { outcome: "verified" };
  }

  let parcel: ParcelFeature | null;
  try {
    parcel = await parcelAtPoint(input.state, match.point);
  } catch (e) {
    return { outcome: "unverified", note: `address layer disagrees with the geocode but the cadastre lookup failed: ${(e as Error).message}` };
  }
  if (!parcel || parcel.kind !== "lot") {
    return { outcome: "unverified", note: `the ${input.state} address layer places this address where the cadastre has no titled lot — geocode kept` };
  }
  return {
    outcome: "corrected",
    parcel,
    areaSqm: parcel.areaSqm ?? Math.round(ringAreaSqm(parcel.ring)),
    point: match.point,
    note: `geocoder had put this on ${input.parcelLabel ?? "another lot"} — corrected from the ${input.state} address layer (${match.full})`,
  };
}
