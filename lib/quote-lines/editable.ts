// "Ready To Send" is a LOCKED state for line items — put the Quote back to Draft first.
//
// The org's own rule says so in its error message: "If you are adding a new Line Item, please
// make sure the Status is 'Draft'." Reproduced 2026-09-21 against the scratch Quote — creating
// a QuoteLineItem on a Ready To Send Quote fails with FIELD_CUSTOM_VALIDATION_EXCEPTION, because
// the org's after-insert flows re-save the Quote and its status validation rules run again:
//
//   Status cannot be 'Ready To Send' because 1 or more Quote Line Items still contain 'XXX'
//
// (`Quote_Not_In_Draft_Status` on QuoteLineItem — the rule that would have said this directly —
// is INACTIVE in the org, so the error arrives from the Quote's rules instead and reads as if
// the problem were the OLD line items. It isn't: the new one has no Description yet.)
//
// ⚠️ It is NOT flipped back afterwards, and that is deliberate, not a missing step. A Quote that
// has just gained a line item CANNOT return to Ready To Send until someone fills that line's
// templated text and markup — those are the very rules above. Flipping back would fail, and if
// it somehow succeeded it would mark an unchecked quote as sendable.
//
// Only ever flips from "Ready To Send". Those are the only two ACTIVE picklist values (verified
// by describe), so anything else is a legacy value like "Sent" (8 records) which cannot be set
// again once cleared — leaving that alone and letting the error surface is the safer failure.

import { soqlQuery, updateRecord } from "@/lib/salesforce";
import { MarkupSyncError, soqlEscape } from "@/lib/markup-sync";

export const LOCKED_STATUS = "Ready To Send";
export const EDITABLE_STATUS = "Draft";

/** Puts a Ready To Send Quote back to Draft so line items can be added or removed.
 *  Returns the status it changed FROM, or null when it did nothing. */
export async function ensureQuoteEditable(quoteId: string): Promise<string | null> {
  const [quote] = await soqlQuery<{ Id: string; Status: string | null }>(
    `SELECT Id, Status FROM Quote WHERE Id = '${soqlEscape(quoteId)}' LIMIT 1`
  );
  if (!quote) throw new MarkupSyncError(`No Quote found for "${quoteId}".`);
  if (quote.Status !== LOCKED_STATUS) return null;
  await updateRecord("Quote", quoteId, { Status: EDITABLE_STATUS });
  return quote.Status;
}
