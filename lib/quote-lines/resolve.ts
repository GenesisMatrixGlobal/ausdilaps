// Read-only half of "Sync to Salesforce" for line items: which Quote, what it already has on it,
// and which PricebookEntry each sheet product maps to on THAT Quote's price book.
//
// Separate from lib/markup-sync.ts's resolveQuoteTarget on purpose — that one walks the Box
// folder chain for filing a PNG, which a line-item create has no use for.
//
// A QuoteLineItem is created against a PricebookEntry, not a Product2: the same product has one
// entry per price book, and a Quote can only take entries from its own book. So the entries are
// read fresh per Quote, and a product with no entry there refuses the row (see payload.ts)
// rather than being created against some other book's price.

import { soqlQuery } from "@/lib/salesforce";
import { MarkupSyncError, parseQuoteLookup, soqlEscape } from "@/lib/markup-sync";
import { SHEET_PRODUCTS } from "@/lib/markup-layers/salesforce-picklists";

export interface QuoteForLines {
  id: string;
  name: string | null;
  number: string | null;
  opportunityName: string | null;
  pricebook2Id: string | null;
  existingLines: number;
  /** Lightning record page, for the "Open the Quote" link. */
  url: string | null;
}

interface QuoteRecord {
  Id: string;
  Name?: string | null;
  QuoteNumber?: string | null;
  Pricebook2Id?: string | null;
  Opportunity?: { Name?: string | null } | null;
  QuoteLineItems?: { totalSize?: number } | null;
}

/** `https://ausdilaps.my.salesforce.com` → `https://ausdilaps.lightning.force.com`. The My
 *  Domain login host is the one env var this code has; the Lightning host follows from it. */
export function lightningUrl(recordId: string, object = "Quote"): string | null {
  const login = process.env.SF_LOGIN_URL;
  const host = login?.match(/^https:\/\/([^.]+)\.my\.salesforce\.com/i)?.[1];
  return host ? `https://${host}.lightning.force.com/lightning/r/${object}/${recordId}/view` : null;
}

async function quoteIdForLineItem(lineItemId: string): Promise<string> {
  const [row] = await soqlQuery<{ QuoteId: string }>(
    `SELECT QuoteId FROM QuoteLineItem WHERE Id = '${soqlEscape(lineItemId)}' LIMIT 1`
  );
  if (!row) throw new MarkupSyncError(`No Quote Line Item found for "${lineItemId}".`);
  return row.QuoteId;
}

export async function resolveQuoteForLines(quoteInput: string): Promise<{
  quote: QuoteForLines;
  pricebookEntryByProduct2Id: Map<string, string>;
}> {
  const lookup = parseQuoteLookup(quoteInput);
  // A pasted LINE ITEM still means "this Quote" here — the sheet adds lines to the Quote, it
  // has nothing to do to an existing line.
  const where =
    lookup.kind === "lineItemId"
      ? `Id = '${soqlEscape(await quoteIdForLineItem(lookup.value))}'`
      : lookup.kind === "id"
        ? `Id = '${soqlEscape(lookup.value)}'`
        : `QuoteNumber = '${soqlEscape(lookup.value)}'`;

  // LIMIT 2 so an ambiguous Quote Number errors instead of guessing.
  const records = await soqlQuery<QuoteRecord>(
    `SELECT Id, Name, QuoteNumber, Pricebook2Id, Opportunity.Name, (SELECT Id FROM QuoteLineItems) ` +
      `FROM Quote WHERE ${where} LIMIT 2`
  );
  if (records.length === 0) throw new MarkupSyncError(`No Quote found for "${lookup.value}".`);
  if (records.length > 1) {
    throw new MarkupSyncError(
      `More than one Quote matches "${lookup.value}" — open the record and paste its URL instead.`
    );
  }
  const q = records[0];
  const quote: QuoteForLines = {
    id: q.Id,
    name: q.Name ?? null,
    number: q.QuoteNumber ?? null,
    opportunityName: q.Opportunity?.Name ?? null,
    pricebook2Id: q.Pricebook2Id ?? null,
    existingLines: q.QuoteLineItems?.totalSize ?? 0,
    url: lightningUrl(q.Id),
  };

  if (!quote.pricebook2Id) {
    throw new MarkupSyncError(
      `Quote ${quote.number ?? quote.id} has no price book — choose one on the Quote in Salesforce first.`
    );
  }

  const productIds = SHEET_PRODUCTS.map((p) => `'${p.product2Id}'`).join(", ");
  const entries = await soqlQuery<{ Id: string; Product2Id: string }>(
    `SELECT Id, Product2Id FROM PricebookEntry WHERE Pricebook2Id = '${soqlEscape(quote.pricebook2Id)}' ` +
      `AND IsActive = true AND Product2Id IN (${productIds})`
  );
  // Product2Id comes back as the 18-character form; SHEET_PRODUCTS holds the 15-character
  // form the org's list page shows. The first 15 are the id; the last 3 are a checksum.
  const pricebookEntryByProduct2Id = new Map(entries.map((e) => [e.Product2Id.slice(0, 15), e.Id]));
  return { quote, pricebookEntryByProduct2Id };
}
