// Reads an edited quoting sheet back in, so the surviving rows can be turned into a map.
//
// The client's job is to delete rows. Everything here is built around telling you exactly
// what happened to every row rather than quietly doing its best: a row that cannot be
// placed is reported, never dropped on the floor.

import Papa from "papaparse";
import { fingerprintOf } from "./fingerprint";

export interface EditedRow {
  /** The segment_id cell, trimmed. Empty when the column is missing or blank. */
  segmentId: string;
  /** Every column as-is, so downstream can read edited lanes/notes without a schema. */
  values: Record<string, string>;
  /** 1-based row number in the file, for pointing at a problem row. */
  line: number;
}

export interface ParsedSheet {
  rows: EditedRow[];
  /** Column headers exactly as they appeared. */
  headers: string[];
  /** True when a `segment_id` column was present at all. */
  hasSegmentId: boolean;
  /** Distinct fingerprints seen across the id column. */
  fingerprints: string[];
}

export class SheetParseError extends Error {}

const ID_HEADERS = ["segment_id", "segmentid", "segment id", "id"];

function findIdKey(headers: string[]): string | null {
  return headers.find((h) => ID_HEADERS.includes(h.trim().toLowerCase())) ?? null;
}

export function parseEditedSheet(text: string): ParsedSheet {
  // Excel on a Mac still writes UTF-8 with a BOM; left in place it makes the first header
  // "﻿segment_id", which then matches nothing.
  const cleaned = text.replace(/^﻿/, "");
  const out = Papa.parse<Record<string, string>>(cleaned, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const headers = (out.meta.fields ?? []).map((h) => h.trim());
  if (headers.length === 0) throw new SheetParseError("That file has no header row.");

  const idKey = findIdKey(headers);
  const rows: EditedRow[] = [];
  const fingerprints = new Set<string>();

  out.data.forEach((raw, i) => {
    const values: Record<string, string> = {};
    for (const h of headers) values[h] = (raw[h] ?? "").toString().trim();
    // A row where every cell is blank is a formatting artefact, not a deletion the client
    // meant us to notice.
    if (Object.values(values).every((v) => v === "")) return;

    const segmentIdValue = idKey ? values[idKey] : "";
    const fp = fingerprintOf(segmentIdValue);
    if (fp) fingerprints.add(fp);
    rows.push({ segmentId: segmentIdValue, values, line: i + 2 }); // +2: 1-based, past header
  });

  if (rows.length === 0) throw new SheetParseError("That sheet has a header but no rows.");

  return { rows, headers, hasSegmentId: !!idKey, fingerprints: [...fingerprints] };
}
