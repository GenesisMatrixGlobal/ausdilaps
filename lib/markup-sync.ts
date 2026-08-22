// Sync To Salesforce — files a generated markup PNG into a job's Box folder and, optionally,
// writes the Box link onto the Salesforce Quote.
//
// The chain an operator would otherwise walk by hand:
//   Quote (pasted URL) -> parent Opportunity -> its Box Folder Link
//     -> "2. Estimations" -> "Site Markup" -> upload -> link back onto the Quote
//
// Split into resolve and upload so the operator confirms the real Opportunity name and
// destination folder before anything is written. Filing a markup against the wrong job is
// the mistake this exists to prevent, and it's invisible once it's happened.
//
// Named markup-sync rather than site-markup to avoid reading as part of
// lib/kml/site-markup/, which is the Road Markup renderer.

import {
  BoxConfigError,
  ensureSharedLink,
  findChildFolder,
  getAccessToken as getBoxToken,
  listFolderItems,
  parseBoxFolderId,
  sanitiseBoxFilename,
  uploadFile,
} from "@/lib/box";
import { SalesforceConfigError, soqlQuery, updateRecord } from "@/lib/salesforce";

/** Folder naming convention inside an Opportunity's Box folder. Constants rather than
 *  config: when the convention has drifted the operator pastes a folder link instead, which
 *  is cheaper than making every level configurable. */
const ESTIMATIONS_FOLDER = "2. Estimations";
const SITE_MARKUP_FOLDER = "Site Markup";

/** Custom field API names differ per org, so they're configurable — a wrong guess is then a
 *  Vercel change rather than a redeploy. Salesforce's own INVALID_FIELD error names the bad
 *  field, and we quote it verbatim, so a mismatch is self-diagnosing. */
function boxFolderField(): string {
  return process.env.SF_OPPORTUNITY_BOX_FOLDER_FIELD ?? "Link_to_Box_Files__c";
}
/**
 * The Quote holds up to five markups, each a URL field paired with a name field. Verified
 * against the live org: 82% of Quotes already have slot 1 filled and 29 use all five, so
 * always writing to slot 1 would destroy existing work.
 *
 * Note slot 1's URL field has no "1" in it while its name field does — that asymmetry is
 * real, not a typo.
 */
const MARKUP_SLOTS = [
  { url: "Site_Mark_Up__c", name: "Site_Mark_Up_1_Name__c" },
  { url: "Site_Mark_Up_2__c", name: "Site_Mark_Up_2_Name__c" },
  { url: "Site_Mark_Up_3__c", name: "Site_Mark_Up_3_Name__c" },
  { url: "Site_Mark_Up_4__c", name: "Site_Mark_Up_4_Name__c" },
  { url: "Site_Mark_Up_5__c", name: "Site_Mark_Up_5_Name__c" },
] as const;

/** Name fields are 150 chars in the org; URL fields are 255 and a Box link is well under. */
const SLOT_NAME_MAX = 150;

interface QuoteSlots { Id: string; [field: string]: unknown }

/** First slot with no URL, or null when all five are taken. */
function firstFreeSlot(quote: QuoteSlots): number | null {
  const index = MARKUP_SLOTS.findIndex((slot) => {
    const value = quote[slot.url];
    return value === null || value === undefined || value === "";
  });
  return index === -1 ? null : index;
}

export class MarkupSyncError extends Error {}

/** True when the failure is missing configuration rather than a bad request. */
export function isConfigError(e: unknown): boolean {
  return e instanceof SalesforceConfigError || e instanceof BoxConfigError;
}

type QuoteLookup = { kind: "id" | "number"; value: string };

const SF_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

/**
 * Works out what was pasted: a Lightning/Classic record URL, a bare 15- or 18-character
 * record Id, or a Quote Number.
 *
 * URLs are searched by pathname only — a host like `ausdilaps--dev.lightning.force.com`
 * contains alphanumeric runs that would otherwise look like record Ids.
 */
export function parseQuoteLookup(input: string): QuoteLookup {
  const trimmed = input.trim();
  if (!trimmed) throw new MarkupSyncError("Paste a Salesforce Quote URL, Id or number.");

  if (/^https?:\/\//i.test(trimmed)) {
    let path: string;
    try {
      path = new URL(trimmed).pathname;
    } catch {
      throw new MarkupSyncError("That doesn't look like a valid URL.");
    }

    // Lightning: /lightning/r/Quote/0Q0.../view
    const lightning = path.match(/\/r\/[^/]+\/([a-zA-Z0-9]{15,18})/);
    if (lightning) return { kind: "id", value: lightning[1] };

    // Classic and anything else: the last path segment shaped like a record Id.
    const candidates = path.split("/").filter((seg) => SF_ID.test(seg));
    if (candidates.length > 0) return { kind: "id", value: candidates[candidates.length - 1] };

    throw new MarkupSyncError("Couldn't find a Salesforce record Id in that URL.");
  }

  if (SF_ID.test(trimmed)) return { kind: "id", value: trimmed };
  return { kind: "number", value: trimmed };
}

/** SOQL string literals escape backslash and single quote — without this a quote number
 *  containing an apostrophe would break the query (or worse). */
function soqlEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

interface QuoteRecord {
  Id: string;
  Name?: string | null;
  QuoteNumber?: string | null;
  Opportunity?: Record<string, unknown> | null;
}

export interface ResolvedTarget {
  quoteId: string;
  quoteNumber: string | null;
  quoteName: string | null;
  opportunityName: string | null;
  boxFolderLink: string | null;
  /** Destination folder. Null when the chain couldn't be walked — see needsManualFolder. */
  folder: { id: string; path: string } | null;
  /** The operator is asked to paste a Box folder link instead. */
  needsManualFolder: boolean;
  /** Which link in the chain was missing, for the message shown alongside the paste box. */
  missingStep?: string;
  suggestedFilename: string;
  /** 1-based slot the link would be written to, or null when all five are taken. */
  nextMarkupSlot: number | null;
  markupSlotsUsed: number;
  markupSlotsTotal: number;
}

function suggestFilename(quoteNumber: string | null, quoteId: string, opportunityName: string | null): string {
  const parts = [quoteNumber ?? quoteId, opportunityName, "Site Markup"].filter(Boolean);
  return sanitiseBoxFilename(`${parts.join(" - ")}.png`);
}

/**
 * Read-only. Resolves the Quote, its Opportunity and the destination folder.
 *
 * `boxFolderOverrideUrl` is the escape hatch for a drifted folder convention: the operator
 * is saying "put it *here*", so that folder is used directly rather than searched for a
 * "2. Estimations" child.
 */
export async function resolveQuoteTarget(opts: {
  quoteInput: string;
  boxFolderOverrideUrl?: string;
}): Promise<ResolvedTarget> {
  const lookup = parseQuoteLookup(opts.quoteInput);
  const field = boxFolderField();

  const where =
    lookup.kind === "id"
      ? `Id = '${soqlEscape(lookup.value)}'`
      : `QuoteNumber = '${soqlEscape(lookup.value)}'`;
  const slotFields = MARKUP_SLOTS.map((s) => s.url).join(", ");
  const records = await soqlQuery<QuoteRecord>(
    `SELECT Id, Name, QuoteNumber, ${slotFields}, Opportunity.Name, Opportunity.${field} FROM Quote WHERE ${where} LIMIT 2`
  );

  if (records.length === 0) {
    throw new MarkupSyncError(`No Quote found for "${lookup.value}".`);
  }
  if (records.length > 1) {
    throw new MarkupSyncError(
      `More than one Quote matches "${lookup.value}" — open the record and paste its URL instead.`
    );
  }

  const quote = records[0];
  const opportunityName = (quote.Opportunity?.Name as string | undefined) ?? null;
  const rawLink = (quote.Opportunity?.[field] as string | undefined) ?? null;
  const base: Omit<ResolvedTarget, "folder" | "needsManualFolder" | "missingStep"> = {
    quoteId: quote.Id,
    quoteNumber: quote.QuoteNumber ?? null,
    quoteName: quote.Name ?? null,
    opportunityName,
    boxFolderLink: rawLink,
    suggestedFilename: suggestFilename(quote.QuoteNumber ?? null, quote.Id, opportunityName),
    nextMarkupSlot: (() => {
      const free = firstFreeSlot(quote as unknown as QuoteSlots);
      return free === null ? null : free + 1;
    })(),
    markupSlotsUsed: MARKUP_SLOTS.filter((slot) => {
      const v = (quote as unknown as QuoteSlots)[slot.url];
      return v !== null && v !== undefined && v !== "";
    }).length,
    markupSlotsTotal: MARKUP_SLOTS.length,
  };

  const manual = opts.boxFolderOverrideUrl?.trim();
  const token = await getBoxToken();

  if (manual) {
    const folderId = parseBoxFolderId(manual);
    if (!folderId) {
      throw new MarkupSyncError(
        "That isn't a Box folder link — it should look like https://ausdilaps.app.box.com/folder/123456789"
      );
    }
    // Listing doubles as an existence and access check before anything is written.
    await listFolderItems(folderId, token);
    return { ...base, folder: { id: folderId, path: "(folder you pasted)" }, needsManualFolder: false };
  }

  const needsManual = (missingStep: string): ResolvedTarget => ({
    ...base,
    folder: null,
    needsManualFolder: true,
    missingStep,
  });

  if (!rawLink) return needsManual(`the Opportunity has no ${field} value`);

  const rootId = parseBoxFolderId(rawLink);
  if (!rootId) return needsManual(`the Opportunity's ${field} isn't a Box folder link`);

  const estimations = await findChildFolder(rootId, ESTIMATIONS_FOLDER, token);
  if (!estimations) return needsManual(`no "${ESTIMATIONS_FOLDER}" folder in the Opportunity's Box folder`);

  const siteMarkup = await findChildFolder(estimations.id, SITE_MARKUP_FOLDER, token);
  if (!siteMarkup) return needsManual(`no "${SITE_MARKUP_FOLDER}" folder inside "${estimations.name}"`);

  return {
    ...base,
    folder: { id: siteMarkup.id, path: `${estimations.name} / ${siteMarkup.name}` },
    needsManualFolder: false,
  };
}

export interface UploadResult {
  fileId: string;
  fileName: string;
  sharedLink: string | null;
  linkedToQuote: boolean;
  /** Set when the file uploaded but writing the link to Salesforce failed. */
  linkError?: string;
  /** 1-based Site Mark Up slot the link was written to. */
  markupSlot?: number;
}

/**
 * Uploads the markup, then optionally writes its Box link onto the Quote.
 *
 * A failed link is reported but not rolled back: the file is correctly filed in Box, and
 * deleting it to "undo" would lose work over a field-permission problem the operator can fix
 * and retry. The caller surfaces `linkError` so the partial success is explicit.
 */
export async function uploadMarkup(opts: {
  quoteId: string;
  folderId: string;
  filename: string;
  bytes: Uint8Array;
  linkToQuote: boolean;
}): Promise<UploadResult> {
  const token = await getBoxToken();
  const file = await uploadFile({
    folderId: opts.folderId,
    filename: opts.filename,
    bytes: opts.bytes,
    token,
  });

  if (!opts.linkToQuote) {
    return { fileId: file.id, fileName: file.name, sharedLink: null, linkedToQuote: false };
  }

  try {
    // Enterprise-only, not public: this is a job document, unlike the marketing samples.
    const sharedLink = await ensureSharedLink(file.id, token, "company");

    // Re-read the slots at write time rather than trusting the resolve step — someone else
    // may have filled one in between, and overwriting a colleague's markup is unrecoverable.
    const slotFields = MARKUP_SLOTS.map((slot) => slot.url).join(", ");
    const [quote] = await soqlQuery<QuoteSlots>(
      `SELECT Id, ${slotFields} FROM Quote WHERE Id = '${soqlEscape(opts.quoteId)}' LIMIT 1`
    );
    if (!quote) throw new MarkupSyncError("That Quote no longer exists.");

    const free = firstFreeSlot(quote);
    if (free === null) {
      throw new MarkupSyncError(
        `All ${MARKUP_SLOTS.length} Site Mark Up slots on this Quote are already filled — clear one to link this file. It is uploaded to Box either way.`
      );
    }

    const slot = MARKUP_SLOTS[free];
    await updateRecord("Quote", opts.quoteId, {
      [slot.url]: sharedLink,
      [slot.name]: file.name.slice(0, SLOT_NAME_MAX),
    });
    return {
      fileId: file.id,
      fileName: file.name,
      sharedLink,
      linkedToQuote: true,
      markupSlot: free + 1,
    };
  } catch (e) {
    return {
      fileId: file.id,
      fileName: file.name,
      sharedLink: null,
      linkedToQuote: false,
      linkError: e instanceof Error ? e.message : String(e),
    };
  }
}
