// Bulk Property Sizing → LineItemSource. One row per looked-up address.
//
// Seeds agreed 2026-09-10: the product is Residential House (Residential Unit when the address
// is a unit), and the DWELLING AREA estimate lands in Internal m² — that is the floor area an
// internal inspection is priced on. The lot size stays on display only; nothing external is
// pre-filled, because a house lookup says nothing about what external assets are in scope.
//
// A row whose lookup did not resolve cleanly (not found, no parcel, a house number the
// geocoder disagreed with) arrives UNTICKED: its numbers are a guess until someone has looked,
// and a guess should not be one click from a Quote.

import type { SizingResult } from "@/lib/property-sizing/types";
import type { LineItemSource } from "../source";

export const SIZING_KEY_PREFIX = "sizing:";

/** Keys are positional — the results list is replaced wholesale on every lookup, and the
 *  drafts and tick state are reset with it, so nothing outlives the run it was keyed for. */
export function sizingKey(index: number): string {
  return `${SIZING_KEY_PREFIX}${index}`;
}

function isUnit(street: string): boolean {
  return /^\s*(unit|u\b|apt|apartment)/i.test(street) || /^\s*\d+[a-z]?\s*\//i.test(street);
}

export function sourceFromSizing(result: SizingResult, index: number): LineItemSource {
  const dwelling =
    result.dwellingAreaSqm && result.dwellingAreaSqm > 0 ? String(Math.round(result.dwellingAreaSqm)) : "";
  return {
    key: sizingKey(index),
    label: "Property",
    street: result.street || null,
    suburb: result.suburb || null,
    lotPlan: result.lotPlan,
    measured: result.matchedAddress ?? "",
    swatch: null,
    seed: {
      product: isUnit(result.street) ? "Residential Unit" : "Residential House",
      street: result.street,
      internalMetres: dwelling,
      externalMetres: "",
      // The storey estimate, editable like every other cell — it goes to Levels__c.
      levels: result.levels && result.levels > 0 ? String(result.levels) : "1",
    },
    included: true,
    startSelected: result.status === "ok",
    detail: { kind: "sizing", result },
  };
}

export function sourcesFromSizing(results: SizingResult[]): LineItemSource[] {
  return results.map(sourceFromSizing);
}
