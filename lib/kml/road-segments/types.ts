import type { LatLng } from "@/lib/kml/types";
import type { RoadLeg } from "./google-directions";

/** One row of a council footpath/road register (e.g. ZONE, LOCATION, ROAD NAME, FROM DESC, TO DESC, FOOTPATH LENGTH). */
export interface RoadSegmentInput {
  id?: string;
  zone?: string;
  /** Suburb/locality, e.g. "Kuraby". */
  location: string;
  roadNo?: string;
  roadName: string;
  fromDesc: string;
  toDesc: string;
  /** As printed on the sheet — "N/A" or blank means no footpath on this segment. */
  footpathLengthKm?: number | null;
  /**
   * Appended after `location` in Google geocoding queries — defaults to "QLD, Australia"
   * (this tool's original council-register use case). Pass "Australia" (or omit the
   * state) when `location` already carries its own state/postcode, e.g. "Newport, VIC 3015"
   * — otherwise the two conflict and Google can geocode to somewhere nonsensical.
   */
  regionHint?: string;
}

export type RoadTraceStatus = "ok" | "geocode_failed" | "route_failed" | "error";

export interface RoadTraceResult {
  input: RoadSegmentInput;
  status: RoadTraceStatus;
  /** Traced road centerline between the FROM and TO points, in order. Null unless status is "ok". */
  coordinates: LatLng[] | null;
  /** Length of the traced coordinates, in km, for comparison against the sheet's footpath length. */
  tracedLengthKm: number | null;
  /** Human-readable notes: geocode/route failures, length-mismatch sanity check, etc. */
  flags: string[];
  /** Ordered roads travelled, with per-road distance. Only the Google tracer can produce
   *  this (it comes out of the Directions step instructions); the OSM tracer omits it. */
  roads?: RoadLeg[];
}

export interface GeocodedIntersection extends LatLng {
  formattedAddress: string;
  /** False if Google matched something less precise than an actual intersection (e.g. just the suburb). */
  isIntersection: boolean;
}

export type MapsLinkStatus = "ok" | "not_found" | "error";

export interface MapsLinkResult {
  input: RoadSegmentInput;
  status: MapsLinkStatus;
  origin: GeocodedIntersection | null;
  destination: GeocodedIntersection | null;
  /** Google Maps directions deep-link — null unless status is "ok". */
  mapsUrl: string | null;
  /** True if we confirmed the route actually travels along roadName (vs. just start/end matching). */
  followsRoad: boolean;
  flags: string[];
}
