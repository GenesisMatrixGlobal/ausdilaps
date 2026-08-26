// Row shaping and CSV/TSV output for the road survey estimator.
//
// One row per KML segment, in the order an estimator reads them: what the road is, how
// long, how many lanes, where it is, what it costs. Uses papaparse (already a dependency
// for the other tools) rather than hand-rolled joining, so a road name with a comma or a
// quote in it cannot break the file.

import Papa from "papaparse";
import { isDividedCarriageway } from "./lanes";
import { laneKm, priceSegment, rateCodeFor } from "./pricing";
import type { EnrichedSegment } from "./types";

/** Column order for the export. Also the header row. */
export const CSV_COLUMNS = [
  "road_name",
  "folder",
  "classific_attr",
  "class_mismatch",
  "colour_hex",
  "provisional",
  "fid",
  "segment_parts",
  "length_km_geometry",
  "length_km_attribute",
  "length_variance_flag",
  "lanes",
  "lanes_source",
  "lanes_min",
  "lanes_max",
  "osm_highway_class",
  "osm_surface",
  "oneway",
  "divided_check_lanes",
  "locality",
  "lga",
  "postcode",
  "start_lat",
  "start_lng",
  "end_lat",
  "end_lng",
  "rate_code",
  "lane_km",
  "price_pre_con",
  "price_post_con",
] as const;

export type CsvRow = Record<(typeof CSV_COLUMNS)[number], string | number>;

/** Rounds for display without letting a float artefact into the sheet. */
const n = (value: number, dp: number) => Number(value.toFixed(dp));

/**
 * `provisionalColours` are the #rrggbb values the estimator flagged as provisional in the
 * tool. Nothing is provisional by default — the Ferrovial brief says "roads highlighted in
 * blue", and that file contains no blue, so guessing here would silently move ~$113k a
 * round between firm and provisional scope.
 */
export function toRows(segments: EnrichedSegment[], provisionalColours: string[]): CsvRow[] {
  const provisional = new Set(provisionalColours.map((c) => c.toLowerCase()));

  return segments.map((s) => {
    const lanes = s.enrichment.lanes ?? 0;
    return {
      road_name: s.roadName,
      folder: s.folder,
      classific_attr: s.classificAttr,
      class_mismatch: s.classMismatch ? "MISMATCH" : "",
      colour_hex: s.colourHex,
      provisional: provisional.has(s.colourHex.toLowerCase()) ? "PROVISIONAL" : "",
      fid: s.fid,
      segment_parts: s.segmentParts,
      length_km_geometry: n(s.lengthKmGeometry, 3),
      length_km_attribute: s.lengthKmAttribute === null ? "" : n(s.lengthKmAttribute, 3),
      length_variance_flag: s.lengthVarianceFlag ?? "",
      lanes,
      lanes_source: s.enrichment.lanesSource,
      lanes_min: s.enrichment.lanesMin ?? "",
      lanes_max: s.enrichment.lanesMax ?? "",
      osm_highway_class: s.enrichment.osmHighwayClass ?? "",
      osm_surface: s.enrichment.osmSurface ?? "",
      oneway: s.enrichment.oneway === null ? "" : s.enrichment.oneway ? "yes" : "no",
      // Not priced, deliberately. See isDividedCarriageway: OSM tags lanes per carriageway,
      // so a divided section needs a human to decide whether both are in scope.
      divided_check_lanes: isDividedCarriageway(s.enrichment) ? "CHECK — lanes are per carriageway" : "",
      locality: s.enrichment.locality ?? "",
      lga: s.enrichment.lga ?? "",
      postcode: s.enrichment.postcode ?? "",
      start_lat: s.start ? n(s.start.lat, 6) : "",
      start_lng: s.start ? n(s.start.lng, 6) : "",
      end_lat: s.end ? n(s.end.lat, 6) : "",
      end_lng: s.end ? n(s.end.lng, 6) : "",
      rate_code: rateCodeFor(s.lengthKmGeometry),
      lane_km: n(laneKm(s.lengthKmGeometry, lanes), 2),
      price_pre_con: n(priceSegment(s.lengthKmGeometry, lanes, "pre"), 2),
      price_post_con: n(priceSegment(s.lengthKmGeometry, lanes, "post"), 2),
    };
  });
}

export function toCsv(rows: CsvRow[]): string {
  return Papa.unparse(rows, { columns: [...CSV_COLUMNS], newline: "\r\n" });
}

/** Tab-separated, for pasting straight into an open Excel sheet. */
export function toTsv(rows: CsvRow[]): string {
  return Papa.unparse(rows, { columns: [...CSV_COLUMNS], delimiter: "\t", newline: "\n" });
}
