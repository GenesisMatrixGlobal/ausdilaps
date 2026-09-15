// "Clear the Quote first" — delete every QuoteLineItem on a Quote and blank its Site Mark Up
// slots, so a re-sync REPLACES what is there instead of adding a second set beside it.
//
// The job this exists for: an estimator re-prices a job, syncs again, and ends up with two of
// everything. There is no server-side dedupe (see lib/quote-lines/payload.ts), so "replace"
// has to be an explicit, opt-in act.
//
// ⚠️ DESTRUCTIVE AND NOT UNDOABLE FROM HERE. Deleted line items go to Salesforce's Recycle Bin
// and the markup URLs are simply overwritten with null. Three things make that safe enough to
// offer:
//   - it only ever runs against a Quote the operator has already resolved and seen on screen
//     (the route takes an Id, never free text, so a typo cannot reach a stranger's Quote);
//   - the caller validates everything it is about to create BEFORE calling this, so the
//     common failure — a refused row — cannot leave a Quote empty;
//   - the FILES IN BOX ARE NOT TOUCHED. Only the Quote's links to them are cleared, so a
//     mistake costs a re-link, not a drawing. (The Box service account is Viewer and could
//     not delete them anyway.)

import { deleteRecords, soqlQuery, updateRecord } from "@/lib/salesforce";
import { MARKUP_SLOTS, MarkupSyncError, soqlEscape } from "@/lib/markup-sync";

/** Salesforce's composite delete ceiling. */
const DELETE_BATCH = 200;
/** Guard against an unbounded loop if a delete silently fails to remove rows. */
const MAX_BATCHES = 15;

export interface QuoteClearResult {
  deletedLines: number;
  clearedMarkupSlots: number;
}

/** Every line item and markup link off one Quote. Returns what it actually removed — the
 *  counts are measured here, not taken from the caller's stale resolve. */
export async function clearQuote(quoteId: string): Promise<QuoteClearResult> {
  const id = soqlEscape(quoteId);
  const slotFields = MARKUP_SLOTS.flatMap((s) => [s.url, s.name]).join(", ");

  // Read FIRST: a bogus Id must fail before anything is deleted, not report a cheerful zero.
  const [quote] = await soqlQuery<Record<string, string | null>>(
    `SELECT Id, ${slotFields} FROM Quote WHERE Id = '${id}' LIMIT 1`
  );
  if (!quote) throw new MarkupSyncError(`No Quote found for "${quoteId}".`);

  let deletedLines = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const rows = await soqlQuery<{ Id: string }>(
      `SELECT Id FROM QuoteLineItem WHERE QuoteId = '${id}' LIMIT ${DELETE_BATCH}`
    );
    if (rows.length === 0) break;
    await deleteRecords(
      "QuoteLineItem",
      rows.map((r) => r.Id)
    );
    deletedLines += rows.length;
    if (rows.length < DELETE_BATCH) break;
  }

  // Only the slots that actually hold something, and the name companions beside them — a name
  // left behind with no URL reads as a markup that failed to upload.
  const blanks: Record<string, null> = {};
  let clearedMarkupSlots = 0;
  for (const slot of MARKUP_SLOTS) {
    const filled = (field: string) => {
      const v = quote[field];
      return v !== null && v !== undefined && v !== "";
    };
    if (filled(slot.url)) clearedMarkupSlots++;
    if (filled(slot.url)) blanks[slot.url] = null;
    if (filled(slot.name)) blanks[slot.name] = null;
  }
  if (Object.keys(blanks).length > 0) await updateRecord("Quote", quoteId, blanks);

  return { deletedLines, clearedMarkupSlots };
}
