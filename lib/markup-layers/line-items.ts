// The Quote Line Item sheet's row model — shared by Building Markup and Bulk Property Sizing.
//
// One row per LineItemSource (see ./source.ts) with the columns an estimator actually prices
// on. Deliberately a SHEET and not a set of per-row controls: the estimator's job here is
// comparing several numbers down a column, which a stack of panels makes impossible.
//
// Cell values are held as STRINGS, the way a spreadsheet holds them, and parsed on read. A
// numeric state would fight the operator on every keystroke (clearing a cell, typing "0.",
// pasting "1,200") and would round "0.80" to "0.8" in a currency column.
//
// There is no line total and no sheet total, deliberately: price is finalised in Salesforce,
// and a total here would be a second figure to reconcile against the real one. The sync sends
// UnitPrice = 1 for the same reason — see lib/quote-lines/payload.ts.

import { assetTypeForProduct } from "./salesforce-picklists";
import type { LineItemSource } from "./source";

/** Rate defaults, per square metre. Applied per row and editable per row — a rate card that
 *  can only be changed globally is the thing estimators work around with a calculator. */
export const DEFAULT_INTERNAL_RATE = 0.8;
export const DEFAULT_EXTERNAL_RATE = 0.3;
export const DEFAULT_QUANTITY = 1;

export interface LineItemDraft {
  street: string;
  suburb: string;
  product: string;
  /** The operator's override. Empty means "follow the product's default" — see assetTypeFor. */
  assetType: string;
  internalMetres: string;
  externalMetres: string;
  internalRate: string;
  externalRate: string;
  quantity: string;
  /** Storeys — QuoteLineItem.Levels__c. Blank means "not sent". */
  levels: string;
}

export const LINE_ITEM_FIELDS: readonly (keyof LineItemDraft)[] = [
  "street",
  "suburb",
  "product",
  "assetType",
  "internalMetres",
  "externalMetres",
  "internalRate",
  "externalRate",
  "quantity",
  "levels",
];

/** Sparse: an absent key, or an absent field, means "still on the default". That is what lets
 *  a re-measured layer pick up its new area while keeping a rate the operator overrode. */
export type LineItemDrafts = Record<string, Partial<LineItemDraft>>;

/** What a row starts as. Everything tool-specific has already been decided by the adapter that
 *  built the source (colour → product for a markup, unit → Residential Unit for sizing). */
export function defaultDraft(source: LineItemSource): LineItemDraft {
  return {
    street: source.seed.street,
    suburb: source.suburb ?? "",
    product: source.seed.product,
    // Empty means "follow the product", which is always seeded — so a row's asset type is
    // filled from the first render without this ever holding a copy of it.
    assetType: "",
    internalMetres: source.seed.internalMetres,
    externalMetres: source.seed.externalMetres,
    internalRate: DEFAULT_INTERNAL_RATE.toFixed(2),
    externalRate: DEFAULT_EXTERNAL_RATE.toFixed(2),
    quantity: String(DEFAULT_QUANTITY),
    levels: source.seed.levels,
  };
}

/**
 * The asset type a row is showing: the operator's override if there is one, otherwise the
 * chosen product's default.
 *
 * Derived rather than stored, so that changing the product moves the asset type with it. The
 * override is cleared by applyCell() when the product changes — an override was made against
 * the old product, and carrying it silently onto a new one is how a row ends up mismatched
 * with what it says it's for.
 */
export function assetTypeFor(values: LineItemDraft): string {
  return values.assetType || assetTypeForProduct(values.product);
}

/** Tolerant of what people paste into a sheet: thousands separators, a stray $, whitespace.
 *  Returns 0 for anything unreadable rather than NaN. */
export function parseCell(value: string): number {
  const n = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export interface LineItemRow {
  key: string;
  source: LineItemSource;
  values: LineItemDraft;
  /** Cells the operator has touched — present in the sparse draft, whether or not the value
   *  changed. Levels is highlighted until it is in here: a seeded storey count must be looked at
   *  before it goes on a Quote. Clicking the cell is enough (the table writes the current value
   *  back), and the state rides along in the save file with the draft. */
  touched: ReadonlySet<keyof LineItemDraft>;
  /** Ticked rows are the ones a sync would create. */
  selected: boolean;
  /**
   * The quote item number, or null when this row isn't a line item.
   *
   * A running counter over the SELECTED rows only, which is what makes the sequence contiguous:
   * untick the second of four and the rest close up to 1, 2, 3. THE single source of the number
   * — the sheet, the sidebar badge, the live map bubble and the exported legend all read it from
   * here, so they cannot disagree.
   *
   * It is a DISPLAY number, not an identity. Nothing joins on it: drafts and deselected are
   * keyed by source key. That is what makes renumbering safe.
   */
  number: number | null;
}

/**
 * The sheet's rows. Excluded sources are dropped, not greyed — unticking a lot on the markup is
 * the operator saying it isn't part of the job.
 *
 * `deselected` records what has been UN-ticked rather than what has been ticked, which is what
 * makes a newly drawn shape arrive selected without anything having to remember it. Same
 * convention as excludedIds and hideSubject in the markup tool.
 */
export function rowsFrom(
  sources: LineItemSource[],
  drafts: LineItemDrafts,
  deselected: ReadonlySet<string>
): LineItemRow[] {
  let next = 1;
  return sources
    .filter((source) => source.included)
    .map((source) => {
      const selected = !deselected.has(source.key);
      return {
        key: source.key,
        source,
        values: { ...defaultDraft(source), ...drafts[source.key] },
        touched: new Set(Object.keys(drafts[source.key] ?? {}) as (keyof LineItemDraft)[]),
        selected,
        // Counted in source order, which the adapter fixes (site -> lots -> shapes for a markup).
        number: selected ? next++ : null,
      };
    });
}

/** The item number for every source that has one, keyed by source key — what the map and the
 *  export payload need. Derived from rowsFrom so there is exactly one numbering. */
export function itemNumbers(rows: LineItemRow[]): Map<string, number> {
  return new Map(rows.filter((r) => r.number !== null).map((r) => [r.key, r.number!]));
}

/** The keys a tool should seed its `deselected` set with when a fresh set of sources arrives. */
export function initialDeselected(sources: LineItemSource[]): Set<string> {
  return new Set(sources.filter((s) => s.included && !s.startSelected).map((s) => s.key));
}
