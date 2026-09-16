// The status sheet: numbering, and the CSV.
//
// Pure. The numbering rule is deliberately the same one the quote sheet uses — 1..N over the
// TICKED rows in row order, display only, nothing joins on it — so a badge on the drawing, a
// bubble on the live map and a row in the sheet can never disagree. It is written here rather
// than imported because lib/markup-layers' version is typed against a quote line item, and a
// closeout row has no product, rate or measurement to carry.

import { csvDocument } from "@/lib/csv";
import { INSPECTION_LEGEND, type CloseoutProperty } from "./types";

export interface CloseoutRow {
  property: CloseoutProperty;
  selected: boolean;
  /** 1..N over the ticked rows, or null. */
  number: number | null;
  /** Set once parcels resolve. Null = pinned, not outlined. */
  ring: { lat: number; lng: number }[] | null;
  areaSqm: number | null;
  lotPlan: string | null;
  /** Where the outline or pin sits — the address layer's point when it beat the geocode. */
  point: { lat: number; lng: number };
  /** Why this one is a pin, for the sheet. */
  note: string | null;
}

export function numberRows(rows: CloseoutRow[]): CloseoutRow[] {
  let next = 1;
  return rows.map((r) => ({ ...r, number: r.selected ? next++ : null }));
}

/** The item number per property key — what the map and the export payload need. */
export function rowNumbers(rows: CloseoutRow[]): Map<string, number> {
  return new Map(rows.filter((r) => r.number !== null).map((r) => [r.property.key, r.number!]));
}

export const CLOSEOUT_CSV_COLUMNS = [
  "#",
  "Street",
  "Suburb",
  "State",
  "Postcode",
  "Status",
  "Inspected",
  "Not inspected",
  "Pending",
  "Work orders",
  "Lot / plan",
  "Lot size m²",
  "Mapped as",
  "Note",
  "Work order numbers",
] as const;

/**
 * Every row, ticked or not — unlike the quote sheet's CSV.
 *
 * A closeout CSV is a record of the whole job. Unticking a property decides what goes on the
 * DRAWING (60 fit; a big job has more), and a spreadsheet that silently dropped the other 640
 * would be worse than useless — it would look complete.
 */
export function closeoutCsv(rows: CloseoutRow[]): string {
  return csvDocument(
    CLOSEOUT_CSV_COLUMNS,
    rows.map((r) => {
      const p = r.property;
      return [
        r.number ?? "",
        p.street,
        p.suburb ?? "",
        p.state ?? "",
        p.postcode ?? "",
        INSPECTION_LEGEND[p.color],
        p.counts.green,
        p.counts.red,
        p.counts.orange,
        p.workOrders,
        r.lotPlan ?? "",
        r.areaSqm ?? "",
        r.ring ? "Title boundary" : "Pin",
        r.note ?? "",
        p.numbers.join(" "),
      ];
    })
  );
}
