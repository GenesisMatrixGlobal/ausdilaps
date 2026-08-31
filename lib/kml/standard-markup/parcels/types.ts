import type { LatLng } from "@/lib/kml/types";

/** What the cadastre says this polygon actually is.
 *
 *  Cadastres return more than titled lots. QLD's DCDB carries a "Road Type Parcel" for
 *  every street (no lot/plan, no area, no tenure) and an "Unlinked parcel or interest"
 *  for easements; VIC flags roads with `parcel_road = 'Y'` — 24 of 391 parcels in a
 *  sampled Glen Waverley block. Left unfiltered these arrive as numbered neighbouring
 *  "lots" with no lot number and no area, taking up pin numbers on the exported image.
 *
 *  NSW needs no discriminator: its layer 15 is the Lot layer and returns lots only —
 *  verified against a Baulkham Hills block, 50 parcels, none without a lot id. */
export type ParcelKind = "lot" | "road" | "other";

export interface ParcelFeature {
  /** Outer ring, closed, in WGS84 lat/lng. */
  ring: LatLng[];
  /** Opaque per-state parcel identifier (lotplan | lotidstring/planlabel | parcel_spi). */
  idKey: string;
  areaSqm: number | null;
  kind: ParcelKind;
}

export interface ParcelQueryResult {
  /** The geocoded subject point. */
  point: LatLng;
  matchedAddress: string | null;
  /** Null for states with no fuzzy-match confidence score (VIC). */
  matchScore: number | null;
  /** Every parcel intersecting the query envelope, including the subject parcel itself. */
  candidates: ParcelFeature[];
}
