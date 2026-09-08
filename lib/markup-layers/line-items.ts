// The Quote Line Item sheet that sits under the Building Markup image.
//
// One row per layer the operator has kept — the subject site, each ticked adjoining lot, each
// drawn shape — with the columns an estimator actually prices on. Deliberately a SHEET and not
// a set of per-layer controls in the sidebar: the estimator's job here is comparing several
// numbers down a column, which a stack of panels makes impossible.
//
// Cell values are held as STRINGS, the way a spreadsheet holds them, and parsed on read. A
// numeric state would fight the operator on every keystroke (clearing a cell, typing "0.",
// pasting "1,200") and would round "0.80" to "0.8" in a currency column.
//
// There is no line total and no sheet total, deliberately: price is finalised in Salesforce,
// and a total here would be a second figure to reconcile against the real one.

import { formatArea } from "@/lib/kml/standard-markup/measure";
import { PRODUCT_BY_COLOR, assetTypeForProduct } from "./salesforce-picklists";
import type { MarkupLayer } from "./types";

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
}

/** Sparse: an absent key, or an absent field, means "still on the default". That is what lets
 *  a re-measured layer pick up its new area while keeping a rate the operator overrode. */
export type LineItemDrafts = Record<string, Partial<LineItemDraft>>;

/**
 * What a row starts as.
 *
 * Both the PRODUCT and which measurement column the area lands in come from the layer's
 * colour — see PRODUCT_BY_COLOR. Blue is internal, orange is external, and the asset type
 * arrives with the product rather than being seeded separately.
 *
 * Red — the project site — takes the product but seeds NEITHER measurement. It is the job's own
 * boundary rather than something being inspected, and pre-filling several thousand square
 * metres against a rate would put a plausible, wrong number on the quote's most visible line.
 * So that row opens knowing what it is and waiting for a figure.
 */
export function defaultDraft(layer: MarkupLayer): LineItemDraft {
  const area = layer.areaSqm && layer.areaSqm > 0 ? String(Math.round(layer.areaSqm)) : "";
  return {
    // An orange shape is council / external infrastructure by definition — that is what the
    // colour MEANS on these markups, and it is what the operator was typing into this cell by
    // hand every time. A lot or the subject has a real address instead, and a red or blue shape
    // is part of the property, so neither gets a guess.
    street: layer.street ?? (layer.color === "orange" ? "Council assets" : ""),
    suburb: layer.suburb ?? "",
    product: PRODUCT_BY_COLOR[layer.color],
    // Empty means "follow the product", which is now always seeded — so a row's asset type is
    // filled from the first render without this ever holding a copy of it.
    assetType: "",
    internalMetres: layer.color === "blue" ? area : "",
    externalMetres: layer.color === "orange" ? area : "",
    internalRate: DEFAULT_INTERNAL_RATE.toFixed(2),
    externalRate: DEFAULT_EXTERNAL_RATE.toFixed(2),
    quantity: String(DEFAULT_QUANTITY),
  };
}

/**
 * The asset type a row is showing: the operator's override if there is one, otherwise the
 * chosen product's default.
 *
 * Derived rather than stored, so that changing the product moves the asset type with it. The
 * override is cleared by the product handler in the tab, not here — an override was made
 * against the old product, and carrying it silently onto a new one is how a row ends up
 * mismatched with what it says it's for.
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
  layer: MarkupLayer;
  values: LineItemDraft;
  /** What the markup measured, for the line under the row label — so the estimator can see
   *  where the m² came from and that changing it is an override. */
  measured: string;
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
   * It is a DISPLAY number, not an identity. Nothing joins on it: lineItems and deselected are
   * keyed by layer key, and lotKey/shapeKey use the cadastre id and the shape id. That is what
   * makes renumbering safe, and it replaces the old "a lot's pin must never change number" rule
   * — which produced legends reading 1, 3, 4, 1, 2.
   */
  number: number | null;
}

function measuredLabel(layer: MarkupLayer): string {
  const parts: string[] = [];
  if (layer.lotPlan) parts.push(layer.lotPlan);
  if (layer.mode === "line" && layer.lengthMetres) {
    parts.push(`${layer.lengthMetres.toLocaleString()} m long`);
    if (layer.widthMetres) parts.push(`${layer.widthMetres} m wide`);
  }
  if (layer.areaSqm && layer.areaSqm > 0) parts.push(formatArea(layer.areaSqm));
  return parts.join(" · ") || "not measured";
}

/**
 * The sheet's rows. Excluded layers are dropped, not greyed — unticking a lot on the markup is
 * the operator saying it isn't part of the job.
 *
 * `deselected` records what has been UN-ticked rather than what has been ticked, which is what
 * makes a newly drawn shape arrive selected without anything having to remember it. Same
 * convention as excludedIds and hideSubject elsewhere in this tool.
 */
export function rowsFrom(
  layers: MarkupLayer[],
  drafts: LineItemDrafts,
  deselected: ReadonlySet<string>
): LineItemRow[] {
  let next = 1;
  return layers
    .filter((layer) => layer.included)
    .map((layer) => {
      const selected = !deselected.has(layer.key);
      return {
        key: layer.key,
        layer,
        values: { ...defaultDraft(layer), ...drafts[layer.key] },
        measured: measuredLabel(layer),
        selected,
        // Counted in row order, which layersFrom fixes as site -> lots -> shapes.
        number: selected ? next++ : null,
      };
    });
}

/** The item number for every layer that has one, keyed by layer key — what the map and the
 *  export payload need. Derived from rowsFrom so there is exactly one numbering. */
export function itemNumbers(rows: LineItemRow[]): Map<string, number> {
  return new Map(rows.filter((r) => r.number !== null).map((r) => [r.key, r.number!]));
}
