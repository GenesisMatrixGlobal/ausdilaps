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

import { BoxConfigError, BoxNameConflictError, ensureSharedLink, findChildFolder, getAccessToken as getBoxToken, listFolderItems, parseBoxFolderId, sanitiseBoxFilename, uploadFile } from "@/lib/box";
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

/** QuoteLineItem's single markup URL field.
 *
 *  The Quote carries five numbered slots; a line item has exactly one, so there is no slot
 *  logic here. A field that already holds a link is REFUSED rather than overwritten —
 *  overwriting a colleague's markup is unrecoverable, and the same rule the Quote slots
 *  already follow. */
const LINE_ITEM_MARKUP_FIELD = "Line_Item_Mark_Up__c";

/** Salesforce key prefixes. Fixed per object, so they identify a bare pasted Id. */
const QUOTE_LINE_ITEM_PREFIX = "0QL";

/** Attempts at " (2)", " (3)", ... before giving up on finding a free filename. A Site
 *  Markup folder with twenty same-named drawings in it is a naming problem, not a retry
 *  problem. */
const MAX_RENAME_ATTEMPTS = 20;

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

type QuoteLookup = { kind: "id" | "number" | "lineItemId"; value: string };

const SF_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

/**
 * Works out what was pasted: a Lightning/Classic record URL, a bare 15- or 18-character
 * record Id, or a Quote Number — and whether it points at a Quote or at one of its LINE
 * ITEMS, which file to the line item's own markup field instead of a Quote slot.
 *
 * URLs are searched by pathname only — a host like `ausdilaps--dev.lightning.force.com`
 * contains alphanumeric runs that would otherwise look like record Ids.
 *
 * The object name in a Lightning URL is authoritative when present; a bare Id falls back to
 * the key prefix, which is fixed per object in Salesforce. Guessing wrong just means the
 * record isn't found, which reads as a clear error rather than writing to the wrong place.
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

    // Lightning: /lightning/r/Quote/0Q0.../view or /lightning/r/QuoteLineItem/0QL.../view
    const lightning = path.match(/\/r\/([^/]+)\/([a-zA-Z0-9]{15,18})/);
    if (lightning) {
      const [, object, id] = lightning;
      return { kind: object === "QuoteLineItem" ? "lineItemId" : idKind(id), value: id };
    }

    // Classic and anything else: the last path segment shaped like a record Id.
    const candidates = path.split("/").filter((seg) => SF_ID.test(seg));
    if (candidates.length > 0) {
      const id = candidates[candidates.length - 1];
      return { kind: idKind(id), value: id };
    }

    throw new MarkupSyncError("Couldn't find a Salesforce record Id in that URL.");
  }

  if (SF_ID.test(trimmed)) return { kind: idKind(trimmed), value: trimmed };
  return { kind: "number", value: trimmed };
}

function idKind(id: string): "id" | "lineItemId" {
  return id.startsWith(QUOTE_LINE_ITEM_PREFIX) ? "lineItemId" : "id";
}

/** SOQL string literals escape backslash and single quote — without this a quote number
 *  containing an apostrophe would break the query (or worse). */
export function soqlEscape(value: string): string {
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
  /** 1-based slot the link would be written to, or null when all five are taken. Only
   *  meaningful when `lineItem` is null. */
  nextMarkupSlot: number | null;
  markupSlotsUsed: number;
  markupSlotsTotal: number;
  /** Set when a Quote LINE ITEM was pasted. The file still lands in the Quote's Box
   *  folder — same job, same place — but the link is written to the line item's own
   *  markup field rather than a Quote slot. */
  lineItem: { id: string; label: string; alreadyFilled: boolean } | null;
}

/** "Site Markup - OPT-33482 Rev.0 Rhys 2026 Testing.png" — the kind of file first, then the
 *  Quote's NAME (Rhys, 2026-09-11), which is how the team refers to a quote; the number and the
 *  record Id are fallbacks for a Quote with no name. A line-item paste keeps its "Line 3" tail. */
function suggestFilename(
  quoteName: string | null,
  quoteNumber: string | null,
  quoteId: string,
  lineItemLabel?: string | null
): string {
  const parts = ["Site Markup", quoteName?.trim() || quoteNumber || quoteId, lineItemLabel].filter(Boolean);
  return sanitiseBoxFilename(`${parts.join(" - ")}.png`);
}

interface LineItemRecord {
  Id: string;
  QuoteId: string;
  LineNumber?: string | null;
  Description?: string | null;
  Product2?: { Name?: string | null } | null;
  [field: string]: unknown;
}

/** Resolves a pasted line-item Id to its parent Quote, so the folder chain is walked from
 *  the Quote exactly as it always was — a line item has no Box folder of its own. */
async function resolveLineItem(lineItemId: string) {
  const [record] = await soqlQuery<LineItemRecord>(
    `SELECT Id, QuoteId, LineNumber, Description, Product2.Name, ${LINE_ITEM_MARKUP_FIELD} ` +
      `FROM QuoteLineItem WHERE Id = '${soqlEscape(lineItemId)}' LIMIT 1`
  );
  if (!record) throw new MarkupSyncError(`No Quote Line Item found for "${lineItemId}".`);
  const existing = record[LINE_ITEM_MARKUP_FIELD];
  const name = record.Product2?.Name ?? record.Description ?? null;
  return {
    id: record.Id,
    quoteId: record.QuoteId,
    // "Line 3 — Dilapidation Survey" is what tells the operator they're on the right one.
    label: [record.LineNumber ? `Line ${record.LineNumber}` : null, name].filter(Boolean).join(" — ") || record.Id,
    alreadyFilled: existing !== null && existing !== undefined && existing !== "",
  };
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

  // A line item is resolved to its parent Quote first; everything after this point — the
  // Opportunity, the folder chain, the filename — is the existing Quote path unchanged.
  const lineItem = lookup.kind === "lineItemId" ? await resolveLineItem(lookup.value) : null;

  const where =
    lineItem !== null
      ? `Id = '${soqlEscape(lineItem.quoteId)}'`
      : lookup.kind === "id"
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
    suggestedFilename: suggestFilename(
      quote.Name ?? null,
      quote.QuoteNumber ?? null,
      quote.Id,
      lineItem?.label
    ),
    // Null for a line-item target, so the UI has no Quote slot to offer and no later change
    // can quietly start writing one. The Quote's slots are simply not part of that flow.
    nextMarkupSlot:
      lineItem !== null
        ? null
        : (() => {
            const free = firstFreeSlot(quote as unknown as QuoteSlots);
            return free === null ? null : free + 1;
          })(),
    markupSlotsUsed:
      lineItem !== null
        ? 0
        : MARKUP_SLOTS.filter((slot) => {
            const v = (quote as unknown as QuoteSlots)[slot.url];
            return v !== null && v !== undefined && v !== "";
          }).length,
    markupSlotsTotal: MARKUP_SLOTS.length,
    lineItem,
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
  /** The DIRECT link — what gets written to Salesforce, because that is what the
   *  document-merge step has to be able to fetch as bytes. */
  sharedLink: string | null;
  /** The Box preview page. Only for the "Open in Box" link an operator clicks: a person
   *  wants Box's viewer, a merge tool wants the file. */
  previewLink?: string | null;
  linkedToQuote: boolean;
  /** Set when the file uploaded but writing the link to Salesforce failed. */
  linkError?: string;
  /** 1-based Site Mark Up slot the link was written to. Absent for a line-item link. */
  markupSlot?: number;
  /** The link went to a Quote Line Item's own field rather than a Quote slot. */
  linkedToLineItem?: boolean;
  /** That field already held a link and was overwritten at the operator's request. */
  replacedExistingLink?: boolean;
  /** The .json companion's Box name, when one was sent. */
  sidecarFileName?: string;
  /** Set when the PNG filed but its .json companion didn't. */
  sidecarError?: string;
}

/**
 * Uploads the markup, optionally writes its Box link onto the Quote, and optionally files a
 * .json companion beside it.
 *
 * A failed link is reported but not rolled back: the file is correctly filed in Box, and
 * deleting it to "undo" would lose work over a field-permission problem the operator can fix
 * and retry. The caller surfaces `linkError` so the partial success is explicit. The same
 * applies to the companion — see uploadSidecar.
 */
function splitExtension(filename: string): { stem: string; ext: string } {
  const dot = filename.lastIndexOf(".");
  return dot > 0
    ? { stem: filename.slice(0, dot), ext: filename.slice(dot) }
    : { stem: filename, ext: "" };
}

/**
 * Uploads, stepping the filename to " (2)", " (3)"... until Box accepts it.
 *
 * The operator shouldn't have to think about a name collision: two markups of the same job
 * is completely normal, and the old behaviour was a 409 that stopped the sync and made them
 * retype a filename.
 *
 * Deliberately retries the UPLOAD rather than listing the folder to pick a free name first.
 * listFolderItems() carries `next: { revalidate: 1800 }` for the marketing samples page, so
 * it can be half an hour stale — it would happily hand back a name that a colleague filled
 * ten minutes ago. Box's own 409 is the only current answer. In practice this is one extra
 * call, occasionally two.
 */
async function uploadFileAutoRenamed(opts: {
  folderId: string;
  filename: string;
  bytes: Uint8Array;
  contentType?: string;
  token: string;
}): Promise<{ id: string; name: string }> {
  const { stem, ext } = splitExtension(opts.filename);
  for (let attempt = 1; attempt <= MAX_RENAME_ATTEMPTS; attempt++) {
    const filename = attempt === 1 ? opts.filename : `${stem} (${attempt})${ext}`;
    try {
      return await uploadFile({ ...opts, filename });
    } catch (e) {
      if (!(e instanceof BoxNameConflictError)) throw e;
    }
  }
  throw new MarkupSyncError(
    `Couldn't find a free filename in that folder after ${MAX_RENAME_ATTEMPTS} tries — rename the file and try again.`
  );
}

export async function uploadMarkup(opts: {
  quoteId: string;
  folderId: string;
  filename: string;
  bytes: Uint8Array;
  linkToQuote: boolean;
  /** When set, the link goes to this line item's own markup field instead of a Quote slot.
   *  The file still lands in the Quote's Box folder — a line item has no folder of its own. */
  lineItemId?: string;
  /** The operator has been shown that the line item already has a markup linked and has
   *  asked to replace it. Without this an occupied field is refused, so a stale resolve can
   *  never silently overwrite a colleague's link. */
  replaceExistingLink?: boolean;
  /** The editable source for the image — a Measure or Building Markup save file. Filed
   *  beside the PNG so whoever picks the job up can reopen and adjust it instead of
   *  redrawing from the flattened image. */
  sidecar?: { filename: string; bytes: Uint8Array; contentType?: string };
}): Promise<UploadResult> {
  const token = await getBoxToken();
  // The PNG first, always: it is the deliverable, and the companion is a convenience.
  const file = await uploadFileAutoRenamed({
    folderId: opts.folderId,
    filename: opts.filename,
    bytes: opts.bytes,
    token,
  });

  const unlinked = { fileId: file.id, fileName: file.name, sharedLink: null, linkedToQuote: false };
  // EXCLUSIVE, deliberately. A line-item paste links the markup to that line item's own
  // field and leaves the Quote's five Site Mark Up slots ALONE — it does not do both. A
  // line item is one row of a job that may have a dozen; writing the same file to a shared
  // Quote slot as well would burn one of five slots per row and quickly fill them with
  // duplicates of the same drawing.
  //
  // `linkedToQuote` in the result means "linked to its record", not "linked to the Quote" —
  // for a line item it is true alongside `linkedToLineItem`. Don't "fix" that by adding a
  // Quote write here.
  const linked = !opts.linkToQuote
    ? unlinked
    : opts.lineItemId
      ? await linkMarkupToLineItem(opts.lineItemId, file, token, opts.replaceExistingLink === true)
      : await linkMarkupToQuote(opts.quoteId, file, token);

  // Named off the PNG's ACTUAL name, not the requested one: if the PNG became
  // "... (2).png" the companion has to become "... (2).json" or the pair stop matching in
  // the folder, which is the whole point of filing them together.
  const sidecar = opts.sidecar
    ? await uploadSidecar(
        opts.folderId,
        {
          ...opts.sidecar,
          filename: `${splitExtension(file.name).stem}${splitExtension(opts.sidecar.filename).ext}`,
        },
        token
      )
    : {};

  return { ...linked, ...sidecar };
}

/**
 * Files the .json beside the PNG.
 *
 * Never linked to a Site Mark Up slot: those fields hold an image URL that Salesforce's
 * document-merge step fetches expecting bytes it can render, and a .json in one would
 * produce a merged document with a broken image in it.
 *
 * Failure is reported, never thrown. The PNG is already filed and possibly already linked;
 * turning a companion-file problem into a failed sync would have the operator re-uploading
 * a markup that is sitting in Box correctly.
 */
async function uploadSidecar(
  folderId: string,
  sidecar: { filename: string; bytes: Uint8Array; contentType?: string },
  token: string
): Promise<Pick<UploadResult, "sidecarFileName" | "sidecarError">> {
  try {
    const file = await uploadFileAutoRenamed({
      folderId,
      filename: sidecar.filename,
      bytes: sidecar.bytes,
      contentType: sidecar.contentType ?? "application/json",
      token,
    });
    return { sidecarFileName: file.name };
  } catch (e) {
    return { sidecarError: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Writes the Box link to a Quote Line Item's own markup field.
 *
 * Mirrors linkMarkupToQuote — same "company" shared link, same direct-download URL for
 * Salesforce's document merge, same re-read before writing — but a line item has ONE field
 * rather than five slots, so a filled field is refused instead of falling through to the
 * next one. Overwriting a colleague's markup is unrecoverable.
 */
async function linkMarkupToLineItem(
  lineItemId: string,
  file: { id: string; name: string },
  token: string,
  replaceExisting: boolean
): Promise<UploadResult> {
  try {
    const link = await ensureSharedLink(file.id, token, "company");
    const sharedLink = link.downloadUrl;
    if (!sharedLink) {
      throw new MarkupSyncError(
        "Box didn't return a direct download link for that file — check that downloads are allowed on shared links for this folder. The file is uploaded either way."
      );
    }

    // Re-read at write time, not trusting the resolve step: someone else may have filled it
    // in the meantime.
    const [current] = await soqlQuery<LineItemRecord>(
      `SELECT Id, ${LINE_ITEM_MARKUP_FIELD} FROM QuoteLineItem WHERE Id = '${soqlEscape(lineItemId)}' LIMIT 1`
    );
    if (!current) throw new MarkupSyncError("That Quote Line Item no longer exists.");
    const existing = current[LINE_ITEM_MARKUP_FIELD];
    // Occupied and not authorised: refuse. The operator is shown `alreadyFilled` at resolve
    // time and has to tick the box, so this only fires when someone else filled the field
    // between resolve and upload — exactly the race worth losing.
    if (existing !== null && existing !== undefined && existing !== "" && !replaceExisting) {
      throw new MarkupSyncError(
        "That line item already has a markup linked. Tick \"replace\" and sync again to overwrite it — the file is uploaded to Box either way."
      );
    }

    await updateRecord("QuoteLineItem", lineItemId, { [LINE_ITEM_MARKUP_FIELD]: sharedLink });
    return {
      fileId: file.id,
      fileName: file.name,
      sharedLink,
      previewLink: link.url,
      linkedToQuote: true,
      linkedToLineItem: true,
      replacedExistingLink: existing !== null && existing !== undefined && existing !== "",
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

/** The existing link-it-to-the-Quote path, extracted so the sidecar upload can run whether
 *  or not linking was asked for or succeeded. */
async function linkMarkupToQuote(
  quoteId: string,
  file: { id: string; name: string },
  token: string
): Promise<UploadResult> {
  try {
    // Enterprise-only, not public: this is a job document, unlike the marketing samples.
    const link = await ensureSharedLink(file.id, token, "company");

    // The DIRECT link, not the preview page. Salesforce's document-merge step fetches
    // whatever is in this field expecting image bytes; the preview URL (app.box.com/s/...)
    // returns an HTML viewer page, so merges came out with no markup in them. The direct
    // link (app.box.com/shared/static/....png) serves the file itself.
    //
    // Note it inherits the "company" access above, so it resolves for signed-in
    // enterprise users only. If the merge tool turns out to fetch anonymously this will
    // still fail, and the fix is access: "open" — which makes the file readable by anyone
    // holding the URL, so that is a decision to take deliberately, not a silent default.
    const sharedLink = link.downloadUrl;
    if (!sharedLink) {
      throw new MarkupSyncError(
        "Box didn't return a direct download link for that file — check that downloads are allowed on shared links for this folder. The file is uploaded either way."
      );
    }

    // Re-read the slots at write time rather than trusting the resolve step — someone else
    // may have filled one in between, and overwriting a colleague's markup is unrecoverable.
    const slotFields = MARKUP_SLOTS.map((slot) => slot.url).join(", ");
    const [quote] = await soqlQuery<QuoteSlots>(
      `SELECT Id, ${slotFields} FROM Quote WHERE Id = '${soqlEscape(quoteId)}' LIMIT 1`
    );
    if (!quote) throw new MarkupSyncError("That Quote no longer exists.");

    const free = firstFreeSlot(quote);
    if (free === null) {
      throw new MarkupSyncError(
        `All ${MARKUP_SLOTS.length} Site Mark Up slots on this Quote are already filled — clear one to link this file. It is uploaded to Box either way.`
      );
    }

    const slot = MARKUP_SLOTS[free];
    await updateRecord("Quote", quoteId, {
      [slot.url]: sharedLink,
      [slot.name]: file.name.slice(0, SLOT_NAME_MAX),
    });
    return {
      fileId: file.id,
      fileName: file.name,
      sharedLink,
      previewLink: link.url,
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
