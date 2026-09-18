// Filing a finished closeout markup: the PNG into the opportunity's Box folder, its link onto
// Opportunity.Closeout_Markup__c.
//
// The ONLY write this tool makes to Salesforce. One field, on the record the operator resolved
// and saw on screen — no work order is ever touched, and nothing about a job's status is
// changed by drawing a picture of it.
//
// Deliberately NOT built on markup-sync.ts. That module is Quote-shaped: five numbered slots,
// a line-item branch, and a "which slot is free" rule that has no meaning here. This is one
// field. When the cover-photo tool lands there will be three callers doing "upload to Box, write
// the link to one field", and THAT is the point to extract a shared helper — with three real
// shapes to generalise over rather than two and a guess.

import {
  BoxConfigError,
  ensureSharedLink,
  getAccessToken as getBoxToken,
  parseBoxFolderId,
  sanitiseBoxFilename,
  uploadFileAutoRenamed,
} from "@/lib/box";
import { MarkupSyncError } from "@/lib/markup-sync";
import { SalesforceConfigError, updateRecord } from "@/lib/salesforce";
import { CLOSEOUT_MARKUP_FIELD } from "./opportunity";

export interface CloseoutUploadResult {
  fileId: string;
  fileName: string;
  sharedLink: string;
  linkedToOpportunity: boolean;
  linkError?: string;
  replacedExistingLink: boolean;
  sidecarFileName?: string;
  sidecarError?: string;
}

export function isCloseoutConfigError(e: unknown): boolean {
  return e instanceof BoxConfigError || e instanceof SalesforceConfigError;
}

/** A filename that sorts and reads well in Box beside the closeout letter. */
export function suggestCloseoutFilename(opportunityName: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return sanitiseBoxFilename(`${opportunityName} - Overview Markup ${stamp}.png`);
}

export async function uploadCloseoutMarkup(opts: {
  opportunityId: string;
  /** The Box folder URL off the Opportunity, or one the operator pasted. */
  boxFolderUrl: string;
  filename: string;
  bytes: Uint8Array;
  linkToOpportunity: boolean;
  /** The operator was shown that Closeout_Markup__c already holds a link and chose to replace
   *  it. Without this an occupied field is left alone — the file still uploads. */
  replaceExistingLink: boolean;
  existingMarkupUrl: string | null;
  /** The .json save file, filed beside the PNG so the drawing can be reopened and adjusted
   *  rather than rebuilt. Never linked to the field: that field feeds a document merge, which
   *  fetches it expecting renderable bytes. */
  sidecar?: { filename: string; bytes: Uint8Array; contentType?: string };
}): Promise<CloseoutUploadResult> {
  const folderId = parseBoxFolderId(opts.boxFolderUrl);
  if (!folderId) {
    throw new MarkupSyncError(
      "Couldn't read a Box folder id from that link — paste the folder's Box URL."
    );
  }

  const token = await getBoxToken();
  const file = await uploadFileAutoRenamed({
    folderId,
    filename: sanitiseBoxFilename(opts.filename),
    bytes: opts.bytes,
    contentType: "image/png",
    token,
  });

  // ⚠️ downloadUrl, never url. The preview URL returns an HTML viewer page, and a document
  // merge pointed at one produces a broken image.
  const link = await ensureSharedLink(file.id, token, "company");
  const sharedLink = link.downloadUrl;
  if (!sharedLink) {
    throw new MarkupSyncError(
      "Box gave the file a shared link with downloads disabled, so it can't be used as an image URL."
    );
  }

  const result: CloseoutUploadResult = {
    fileId: file.id,
    fileName: file.name,
    sharedLink,
    linkedToOpportunity: false,
    replacedExistingLink: false,
  };

  // The sidecar is reported, never thrown. The PNG is already filed and possibly linked;
  // failing the whole sync over the companion would have the operator re-uploading a markup
  // that is already where it belongs.
  if (opts.sidecar) {
    try {
      const saved = await uploadFileAutoRenamed({
        folderId,
        filename: sanitiseBoxFilename(opts.sidecar.filename),
        bytes: opts.sidecar.bytes,
        contentType: opts.sidecar.contentType ?? "application/json",
        token,
      });
      result.sidecarFileName = saved.name;
    } catch (e) {
      result.sidecarError = (e as Error).message;
    }
  }

  if (opts.linkToOpportunity) {
    if (opts.existingMarkupUrl && !opts.replaceExistingLink) {
      result.linkError = "This opportunity already has an overview markup — tick Replace to overwrite it.";
    } else {
      try {
        await updateRecord("Opportunity", opts.opportunityId, { [CLOSEOUT_MARKUP_FIELD]: sharedLink });
        result.linkedToOpportunity = true;
        result.replacedExistingLink = Boolean(opts.existingMarkupUrl);
      } catch (e) {
        // Same rule as the sidecar: the file is in Box either way, and the operator can paste
        // the link by hand. Re-uploading would only make a second copy.
        result.linkError = (e as Error).message;
      }
    }
  }

  return result;
}
