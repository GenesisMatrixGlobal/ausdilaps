import type { LatLng } from "@/lib/kml/types";

export interface ParcelFeature {
  /** Outer ring, closed, in WGS84 lat/lng. */
  ring: LatLng[];
  /** Opaque per-state parcel identifier (lotplan | lotidstring/planlabel | parcel_spi). */
  idKey: string;
  areaSqm: number | null;
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
