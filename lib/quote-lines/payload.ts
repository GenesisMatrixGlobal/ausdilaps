// Sheet rows → QuoteLineItem records. Pure: no Salesforce, no network, so the exact records a
// sync would create can be printed and checked offline (scripts/check-quote-lines.ts).
//
// Rules agreed with Rhys, 2026-09-10:
//   - ONE line item per row, even when both internal and external m² are filled — the org has a
//     field for each.
//   - UnitPrice is a deliberate $1 placeholder. Pricing is finalised in Salesforce off the m²
//     and rate fields; a computed price here would be a second figure to reconcile.
//   - Description is NOT sent. Salesforce fills it.
//   - A row that cannot be sent is REFUSED with the reason, and nothing on the Quote is created
//     (the create is all-or-nothing). Skipping a row silently is how a property goes unquoted.

import { assetTypeFor, parseCell, type LineItemDraft } from "@/lib/markup-layers/line-items";
import {
  RATE_FIELDS,
  assetTypeApiValue,
  productByName,
  rateToPicklistValue,
} from "@/lib/markup-layers/salesforce-picklists";

export const PLACEHOLDER_UNIT_PRICE = 1;

/** What the client sends per ticked row. `street` is only for naming the row in a refusal. */
export interface SyncRowInput {
  key: string;
  values: LineItemDraft;
}

export interface Refusal {
  key: string;
  street: string;
  reason: string;
}

export interface QuoteLineItemRecord {
  attributes: { type: "QuoteLineItem" };
  QuoteId: string;
  PricebookEntryId: string;
  Product2Id: string;
  Quantity: number;
  UnitPrice: number;
  [field: string]: unknown;
}

/** Why a row cannot become a line item, or null when it can. Everything here is checkable on
 *  the client before Find, so the footer can say "3 ready, 1 can't sync" up front. The price
 *  book check needs Salesforce and lives in buildQuoteLineItems. */
export function rowReason(values: LineItemDraft): string | null {
  if (!values.product) return "no product chosen";
  if (!productByName(values.product)) return `"${values.product}" isn't a product this sheet can sync`;
  const assetType = assetTypeFor(values);
  if (assetType && !assetTypeApiValue(assetType)) return `asset type "${assetType}" isn't in the picklist`;
  if (parseCell(values.quantity) <= 0) return "quantity must be above 0";
  const internal = parseCell(values.internalMetres);
  const external = parseCell(values.externalMetres);
  if (internal <= 0 && external <= 0) return "no internal or external m²";
  // A rate the org's picklist doesn't have (an old free-typed cell) would be rejected by
  // Salesforce for the whole batch — refused here instead, naming the cell.
  if (internal > 0 && rateToPicklistValue("internal", values.internalRate) === undefined) {
    return `internal rate $${values.internalRate} isn't one of the picklist's values`;
  }
  if (external > 0 && rateToPicklistValue("external", values.externalRate) === undefined) {
    return `external rate $${values.externalRate} isn't one of the picklist's values`;
  }
  return null;
}

function rateFields(kind: keyof typeof RATE_FIELDS, rate: string): Record<string, unknown> {
  const fields = RATE_FIELDS[kind];
  return {
    [fields.currency]: parseCell(rate),
    [fields.picklist]: rateToPicklistValue(kind, rate),
  };
}

export function buildQuoteLineItems(
  rows: SyncRowInput[],
  ctx: { quoteId: string; pricebookEntryByProduct2Id: ReadonlyMap<string, string> }
): { records: QuoteLineItemRecord[]; refused: Refusal[] } {
  const records: QuoteLineItemRecord[] = [];
  const refused: Refusal[] = [];

  for (const row of rows) {
    const v = row.values;
    const refuse = (reason: string) => refused.push({ key: row.key, street: v.street, reason });

    const reason = rowReason(v);
    if (reason) {
      refuse(reason);
      continue;
    }
    const product = productByName(v.product)!;
    const pricebookEntryId = ctx.pricebookEntryByProduct2Id.get(product.product2Id);
    if (!pricebookEntryId) {
      refuse(`"${product.name}" isn't on this Quote's price book`);
      continue;
    }

    const internal = Math.round(parseCell(v.internalMetres));
    const external = Math.round(parseCell(v.externalMetres));
    const assetType = assetTypeFor(v);
    const record: QuoteLineItemRecord = {
      attributes: { type: "QuoteLineItem" },
      QuoteId: ctx.quoteId,
      PricebookEntryId: pricebookEntryId,
      Product2Id: product.product2Id,
      Quantity: parseCell(v.quantity),
      UnitPrice: PLACEHOLDER_UNIT_PRICE,
    };
    if (assetType) record.Property_Type__c = assetTypeApiValue(assetType);
    const levels = Math.round(parseCell(v.levels));
    if (levels > 0) record.Levels__c = levels;
    // A measurement's rate travels only with a measurement — a rate against no m² is noise.
    if (internal > 0) {
      record.Internal_M2__c = internal;
      Object.assign(record, rateFields("internal", v.internalRate));
    }
    if (external > 0) {
      record.External_M2__c = external;
      Object.assign(record, rateFields("external", v.externalRate));
    }
    records.push(record);
  }

  return { records, refused };
}
