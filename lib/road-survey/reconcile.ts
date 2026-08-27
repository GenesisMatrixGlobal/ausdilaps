// Matches an edited sheet back onto a freshly parsed source network.
//
// Everything the client did shows up in the result: what survived, what they deleted, and
// anything that could not be placed. Nothing is silently discarded — a road vanishing from
// a survey map without a word is the failure mode this module exists to prevent.

import { fingerprintOf } from "./fingerprint";
import type { EditedRow, ParsedSheet } from "./parse-csv";
import type { RoadSegment } from "./types";

export interface MatchedSegment {
  segment: RoadSegment;
  /** The sheet row it came from — carries any edits the client made. */
  row: EditedRow;
}

export type MatchMode = "id" | "fallback";

export interface Reconciliation {
  matched: MatchedSegment[];
  /** Sheet rows that matched no segment, with why. */
  unmatchedRows: { row: EditedRow; reason: string }[];
  /** Segments absent from the sheet — i.e. the client removed them. Expected. */
  removed: RoadSegment[];
  mode: MatchMode;
  warnings: string[];
}

/** Loose key for the fallback path: name + folder + length to 3dp. */
function fallbackKey(name: string, folder: string, lengthKm: string): string {
  const km = Number(lengthKm);
  const norm = Number.isFinite(km) ? km.toFixed(3) : lengthKm.trim();
  return `${name.trim().toLowerCase()}|${folder.trim().toLowerCase()}|${norm}`;
}

export function reconcile(segments: RoadSegment[], sheet: ParsedSheet, fingerprint: string): Reconciliation {
  const warnings: string[] = [];
  const matched: MatchedSegment[] = [];
  const unmatchedRows: { row: EditedRow; reason: string }[] = [];
  const usedSegmentIds = new Set<string>();

  // The fingerprint check is the whole reason ids carry a prefix. A sheet cut from a
  // different revision of the network would otherwise match by position and produce a
  // map of the wrong roads.
  const foreign = sheet.fingerprints.filter((f) => f !== fingerprint);
  if (foreign.length > 0) {
    throw new Error(
      `This sheet was made from a different version of the map file (it carries ${foreign.join(", ")}, ` +
        `this file is ${fingerprint}). Use the source file the sheet was generated from, or re-export the sheet.`
    );
  }

  // An id column full of values that are not our shape at all — renumbered by hand, or
  // Excel having "helpfully" turned A296-001 into a date. Matching by id would report every
  // single row as unmatched, which buries the actual cause, so say it once and fall back.
  const idsPresent = sheet.rows.filter((r) => r.segmentId !== "").length;
  const idsParseable = sheet.rows.filter((r) => fingerprintOf(r.segmentId) !== null).length;
  const idsUnusable = sheet.hasSegmentId && idsPresent > 0 && idsParseable === 0;
  if (idsUnusable) {
    warnings.push(
      `The segment_id column doesn't hold recognisable ids (found e.g. "${
        sheet.rows.find((r) => r.segmentId)?.segmentId ?? ""
      }"). They may have been renumbered or reformatted by the spreadsheet. Matched on road name, class and length instead.`
    );
  }

  const mode: MatchMode = sheet.hasSegmentId && !idsUnusable ? "id" : "fallback";

  if (mode === "id") {
    const byId = new Map(segments.map((s) => [s.id, s]));
    for (const row of sheet.rows) {
      if (!row.segmentId) {
        unmatchedRows.push({ row, reason: "no segment_id in this row" });
        continue;
      }
      const seg = byId.get(row.segmentId);
      if (!seg) {
        unmatchedRows.push({ row, reason: `no segment ${row.segmentId} in the map file` });
        continue;
      }
      if (usedSegmentIds.has(seg.id)) {
        unmatchedRows.push({ row, reason: `duplicate of ${row.segmentId}, already used` });
        continue;
      }
      usedSegmentIds.add(seg.id);
      matched.push({ segment: seg, row });
    }
  } else {
    // No id column — the client deleted or renamed it. Match on what's left and say so,
    // rather than refusing outright and stranding them.
    if (!idsUnusable) {
      warnings.push(
        "No segment_id column in that sheet, so rows were matched on road name, class and length instead. " +
          "Check the result — roads that share a name and length can't be told apart this way."
      );
    }
    const byKey = new Map<string, RoadSegment[]>();
    for (const s of segments) {
      const k = fallbackKey(s.roadName, s.folder, s.lengthKmGeometry.toFixed(3));
      byKey.set(k, [...(byKey.get(k) ?? []), s]);
    }
    for (const row of sheet.rows) {
      const k = fallbackKey(
        row.values["road_name"] ?? "",
        row.values["folder"] ?? "",
        row.values["length_km_geometry"] ?? ""
      );
      const candidates = (byKey.get(k) ?? []).filter((s) => !usedSegmentIds.has(s.id));
      if (candidates.length === 0) {
        unmatchedRows.push({ row, reason: "no road in the map file with that name, class and length" });
        continue;
      }
      usedSegmentIds.add(candidates[0].id);
      matched.push({ segment: candidates[0], row });
    }
  }

  const removed = segments.filter((s) => !usedSegmentIds.has(s.id));

  if (unmatchedRows.length > 0) {
    warnings.push(
      `${unmatchedRows.length} row${unmatchedRows.length === 1 ? "" : "s"} in the sheet couldn't be matched ` +
        `and are not in the map.`
    );
  }

  return { matched, unmatchedRows, removed, mode, warnings };
}
