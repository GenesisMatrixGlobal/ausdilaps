// Line items the sheet adds BY ITSELF, from the rows the operator already has (Rhys,
// 2026-09-30). Pure: rows in, sources out, so `npm run check:lines` pins the rules.
//
//   - ACCESS LETTERS — one per ticked residential row (Residential House or Residential Unit),
//     $35 each, TICKED by default. Qty follows the rows live: untick a house and it drops by one.
//   - COMMON AREAS — one per ADDRESS that has a Residential Unit row, seeded with that lot's
//     area on "Common Areas (30%)", UNTICKED by default (opt-in — see LineItemSource.optIn).
//
// The rules read row VALUES (the product the operator chose), not how the row was made, so
// they follow a product change the moment it is made.

import type { LineItemRow } from "./line-items";
import type { LineItemSource } from "./source";

export const ACCESS_LETTERS_KEY = "auto:access-letters";
export const ACCESS_LETTERS_PRODUCT = "Access Letters";
export const COMMON_AREAS_PRODUCT = "Common Areas (30%)";
const RESIDENTIAL = new Set(["Residential House", "Residential Unit"]);

/** "3/12 Smith St" / "Unit 3, 12 Smith St" / "U3 12 Smith St" → "12 Smith St": the block's
 *  address, which is what its common areas belong to. */
export function blockStreet(street: string): string {
  return street
    .trim()
    .replace(/^(?:unit|u|apt|apartment|shop|suite)\s*[\w-]+\s*[,/]?\s*(?=\d)/i, "")
    .replace(/^[\w-]+\s*\/\s*(?=\d)/, "")
    .trim();
}

/** What makes two unit rows "the same address": the lot they sit on (units on one strata lot
 *  arrive as `id`, `id#2`, …), else the row itself (a hand-drawn shape). */
function addressGroup(row: LineItemRow): string {
  const d = row.source.detail;
  if (d.kind === "markup" && d.layer.kind === "lot") return d.layer.key.replace(/#\d+$/, "");
  return row.key;
}

function areaOf(row: LineItemRow): number | null {
  const d = row.source.detail;
  if (d.kind === "markup") return d.layer.areaSqm;
  if (d.kind === "sizing") return d.result.lotSizeSqm ?? null;
  return null;
}

/**
 * The property sources with the derived ones placed among them: each Common Areas row straight
 * after the last unit row of its address, Access Letters last. `rows` is the first pass over
 * `sources` alone (rowsFrom), which is where the chosen products and ticks come from.
 */
export function withDerivedSources(sources: LineItemSource[], rows: LineItemRow[]): LineItemSource[] {
  const out: LineItemSource[] = [];
  const rowByKey = new Map(rows.map((r) => [r.key, r]));

  // Last unit row of each address, so the Common Areas row lands beside its units.
  const lastUnitOf = new Map<string, string>();
  const firstUnitOf = new Map<string, LineItemRow>();
  for (const r of rows) {
    if (r.values.product !== "Residential Unit") continue;
    const g = addressGroup(r);
    lastUnitOf.set(g, r.key);
    if (!firstUnitOf.has(g)) firstUnitOf.set(g, r);
  }

  for (const s of sources) {
    out.push(s);
    const r = rowByKey.get(s.key);
    if (!r) continue;
    const g = addressGroup(r);
    if (lastUnitOf.get(g) !== s.key) continue;
    const unit = firstUnitOf.get(g)!;
    const area = areaOf(unit);
    const street = blockStreet(unit.values.street);
    out.push({
      key: `auto:common:${g}`,
      label: "Common areas",
      street: street || null,
      suburb: unit.values.suburb || null,
      lotPlan: null,
      measured: "Added automatically for a Residential Unit",
      swatch: null,
      seed: {
        product: COMMON_AREAS_PRODUCT,
        street,
        internalMetres: area && area > 0 ? String(Math.round(area)) : "",
        externalMetres: "",
        levels: "",
      },
      included: true,
      startSelected: false,
      optIn: true,
      detail: { kind: "derived", rule: "common-areas" },
    });
  }

  const letters = rows.filter((r) => r.selected && RESIDENTIAL.has(r.values.product)).length;
  if (letters > 0) {
    out.push({
      key: ACCESS_LETTERS_KEY,
      label: "Access letters",
      street: null,
      suburb: null,
      lotPlan: null,
      measured: "Added automatically: 1 per residential row",
      swatch: null,
      seed: {
        product: ACCESS_LETTERS_PRODUCT,
        street: "",
        internalMetres: "",
        externalMetres: "",
        levels: "",
        quantity: String(letters),
      },
      included: true,
      startSelected: true,
      detail: { kind: "derived", rule: "access-letters" },
    });
  }
  return out;
}
