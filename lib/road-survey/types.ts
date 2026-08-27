import type { LatLng } from "@/lib/kml/types";

/** Where a segment's lane count came from — shown in the CSV so an estimator can audit it. */
export type LanesSource =
  /** An explicit OSM `lanes` tag on ways matched to this segment. */
  | "osm"
  /** No `lanes` tag, inferred from the OSM `highway=` class. */
  | "osm-inferred"
  /** No OSM match at all (or enrichment never ran) — the default assumption. */
  | "assumed"
  /** Typed over by hand in the tool. */
  | "manual";

/** One Placemark from the KMZ, priced but not yet enriched. */
export interface RoadSegment {
  /**
   * Stable key for React lists, for merging enrichment on, and — critically — the
   * `segment_id` written into the exported sheet. Shaped "A7F3-001": a fingerprint of the
   * whole network plus the segment's position, so a returned sheet can be matched back
   * against a freshly parsed source file and a mismatched revision is caught. See
   * fingerprint.ts.
   */
  id: string;
  roadName: string;
  /** The KML Folder the Placemark sat in — authoritative (see classMismatch). */
  folder: string;
  /** The `Classific` attribute from the description table, warts and all. */
  classificAttr: string;
  /** True when classificAttr disagrees with folder after normalising plurals. */
  classMismatch: boolean;
  /** Line colour as `#rrggbb`, decoded from KML's `aabbggrr`. */
  colourHex: string;
  fid: string;

  /** Summed geodesic length of every part. The number we price on. */
  lengthKmGeometry: number;
  /** The `Length` attribute from the description table, in km. Null when absent. */
  lengthKmAttribute: number | null;
  /** Set when the attribute and the geometry disagree beyond tolerance. */
  lengthVarianceFlag: string | null;
  start: LatLng | null;
  end: LatLng | null;
  /** Midpoint of the whole path — what we reverse-geocode and bbox around. */
  midpoint: LatLng | null;
  /**
   * The segment's geometry, one entry per LineString in the source Placemark.
   *
   * Kept as separate parts rather than one flattened list: a MultiGeometry holds
   * DISCONTINUOUS runs of the same road, so joining them draws a phantom leg across
   * country between the parts. 8 of the 123 segments in the Ferrovial network are
   * multi-part, one with 10 parts.
   */
  parts: LatLng[][];
}

/** OSM + geocode data laid over a RoadSegment. Every field is optional by design. */
export interface SegmentEnrichment {
  lanes: number | null;
  lanesSource: LanesSource;
  lanesMin: number | null;
  lanesMax: number | null;
  osmHighwayClass: string | null;
  osmSurface: string | null;
  oneway: boolean | null;
  locality: string | null;
  lga: string | null;
  postcode: string | null;
}

export interface EnrichedSegment extends RoadSegment {
  enrichment: SegmentEnrichment;
}
