// Cover Photo sync — files a generated cover photo into a job's Box folder and writes its
// Box link onto the Salesforce Survey record.
//
// The chain an operator would otherwise walk by hand:
//   Survey (pasted URL) -> its Opportunity -> that Opportunity's Box Folder Link
//     -> "4. Reports" -> "Template Documents - Completed" -> upload -> link back onto the Survey
//
// Split into resolve and upload, for the same reason lib/markup-sync.ts is: the operator
// confirms the real Survey and Opportunity name and the destination folder before anything is
// written. Filing a report's cover photo against the wrong job is invisible once it has
// happened.
//
// Deliberately a sibling of markup-sync rather than a generalisation of it. That module
// carries Quote numbers, five numbered markup slots, Quote Line Items and a .json companion;
// a Survey has one field and none of the rest, and threading a second object through all of
// it would cost more than the hundred lines here.

import {
  BoxConfigError,
  ensureSharedLink,
  findChildFolder,
  getAccessToken as getBoxToken,
  listFolderItems,
  parseBoxFolderId,
  sanitiseBoxFilename,
  uploadFileAutoRenamed,
} from "@/lib/box";
import { SalesforceConfigError, soqlQuery, updateRecord } from "@/lib/salesforce";
import { soqlEscape } from "@/lib/markup-sync";

/** Folder naming convention inside an Opportunity's Box folder. Constants rather than config:
 *  when the convention has drifted the operator pastes a folder link instead, which is cheaper
 *  than making every level configurable. Verified against the live tree. */
const REPORTS_FOLDER = "4. Reports";
const COMPLETED_FOLDER = "Template Documents - Completed";

/** Custom field API names differ per org, so they're overridable — a wrong guess is then a
 *  Vercel change rather than a redeploy. All three verified against the org on 2026-09-16.
 *  Salesforce's own INVALID_FIELD error names the bad field and we quote it verbatim, so a
 *  mismatch is self-diagnosing. */
function coverPhotoField(): string {
  return process.env.SF_SURVEY_COVER_PHOTO_FIELD ?? "Cover_Photo_URL__c";
}
function surveyOpportunityField(): string {
  return process.env.SF_SURVEY_OPPORTUNITY_FIELD ?? "Opportunity__c";
}
/** Salesforce derives a lookup's relationship name from the field by swapping `__c` for
 *  `__r`, so it follows from the field rather than being a second thing to configure. */
function surveyOpportunityRelationship(): string {
  return surveyOpportunityField().replace(/__c$/, "__r");
}
function boxFolderField(): string {
  return process.env.SF_OPPORTUNITY_BOX_FOLDER_FIELD ?? "Link_to_Box_Files__c";
}

/** Survey__c's key prefix — fixed per object in Salesforce, so it identifies a bare pasted
 *  Id. Confirmed from EntityDefinition. */
const SURVEY_PREFIX = "a4F";

const SF_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

export class CoverPhotoSyncError extends Error {}

/** True when the failure is missing configuration rather than a bad request. */
export function isConfigError(e: unknown): boolean {
  return e instanceof SalesforceConfigError || e instanceof BoxConfigError;
}

/**
 * The Survey Id out of whatever was pasted: a Lightning/Classic record URL or a bare 15- or
 * 18-character Id.
 *
 * URLs are searched by PATHNAME only — a host like `ausdilaps--dev.lightning.force.com`
 * contains alphanumeric runs that would otherwise look like record Ids.
 *
 * Unlike the markup's parseQuoteLookup there is no "or a record number" branch: a Survey has
 * no human-facing number to paste, so anything that isn't a URL or an Id is rejected here
 * rather than turned into a query that can only fail later.
 */
export function parseSurveyLookup(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new CoverPhotoSyncError("Paste the Salesforce Survey URL.");

  if (/^https?:\/\//i.test(trimmed)) {
    let path: string;
    try {
      path = new URL(trimmed).pathname;
    } catch {
      throw new CoverPhotoSyncError("That doesn't look like a valid URL.");
    }

    // Lightning: /lightning/r/Survey__c/a4FOl00000wZyT4MAK/view
    const lightning = path.match(/\/r\/([^/]+)\/([a-zA-Z0-9]{15,18})/);
    if (lightning) {
      const [, object, id] = lightning;
      // The object name in a Lightning URL is authoritative. Saying so beats letting a pasted
      // Quote URL run on and fail with "no Survey found for 0Q0...", which reads like the
      // record is missing rather than like the wrong link was copied.
      if (object !== "Survey__c") {
        throw new CoverPhotoSyncError(
          `That link points at a ${object} record, not a Survey. Open the Survey and copy its URL.`
        );
      }
      return id;
    }

    // Classic and anything else: the last path segment shaped like a record Id.
    const candidates = path.split("/").filter((seg) => SF_ID.test(seg));
    if (candidates.length > 0) return candidates[candidates.length - 1];

    throw new CoverPhotoSyncError("Couldn't find a Salesforce record Id in that URL.");
  }

  if (SF_ID.test(trimmed)) {
    if (!trimmed.startsWith(SURVEY_PREFIX)) {
      throw new CoverPhotoSyncError(
        `"${trimmed}" isn't a Survey Id — a Survey's Id starts with ${SURVEY_PREFIX}.`
      );
    }
    return trimmed;
  }

  throw new CoverPhotoSyncError("Paste the Salesforce Survey URL, or its record Id.");
}

export interface ResolvedSurvey {
  surveyId: string;
  surveyName: string | null;
  opportunityName: string | null;
  boxFolderLink: string | null;
  /** Destination folder. Null when the chain couldn't be walked — see needsManualFolder. */
  folder: { id: string; path: string } | null;
  /** Signed {surveyId, folderId} from the resolve route; the upload route accepts no other
   *  destination. Absent when no folder was resolved. See lib/box-destination.ts. */
  destinationToken?: string;
  /** The operator is asked to paste a Box folder link instead. */
  needsManualFolder: boolean;
  /** Which link in the chain was missing, for the message shown alongside the paste box. */
  missingStep?: string;
  suggestedFilename: string;
  /** The Survey already has a cover photo linked. Linking is then opt-in, not the default. */
  alreadyFilled: boolean;
}

interface SurveyRecord {
  Id: string;
  Name?: string | null;
  [field: string]: unknown;
}

/** "Cover Photo - RHYS API TEST.png" — the kind of file first, then the Survey's name, which
 *  is how the team refers to it. The record Id is the fallback for an unnamed Survey. */
function suggestFilename(surveyName: string | null, surveyId: string): string {
  return sanitiseBoxFilename(`Cover Photo - ${surveyName?.trim() || surveyId}.png`);
}

function isFilled(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

/**
 * Read-only. Resolves the Survey, its Opportunity and the destination folder.
 *
 * `boxFolderOverrideUrl` is the escape hatch for a drifted folder convention: the operator is
 * saying "put it *here*", so that folder is used directly rather than searched for.
 */
export async function resolveSurveyTarget(opts: {
  surveyInput: string;
  boxFolderOverrideUrl?: string;
}): Promise<ResolvedSurvey> {
  const surveyId = parseSurveyLookup(opts.surveyInput);
  const coverField = coverPhotoField();
  const oppField = surveyOpportunityField();
  const oppRel = surveyOpportunityRelationship();
  const folderField = boxFolderField();

  const records = await soqlQuery<SurveyRecord>(
    `SELECT Id, Name, ${coverField}, ${oppField}, ${oppRel}.Name, ${oppRel}.${folderField} ` +
      `FROM Survey__c WHERE Id = '${soqlEscape(surveyId)}' LIMIT 1`
  );
  if (records.length === 0) {
    throw new CoverPhotoSyncError(`No Survey found for "${surveyId}".`);
  }

  const survey = records[0];
  const opportunity = survey[oppRel] as Record<string, unknown> | null | undefined;
  const opportunityName = (opportunity?.Name as string | undefined) ?? null;
  const rawLink = (opportunity?.[folderField] as string | undefined) ?? null;

  const base = {
    surveyId: survey.Id,
    surveyName: survey.Name ?? null,
    opportunityName,
    boxFolderLink: rawLink,
    suggestedFilename: suggestFilename(survey.Name ?? null, survey.Id),
    alreadyFilled: isFilled(survey[coverField]),
  };

  const manual = opts.boxFolderOverrideUrl?.trim();
  const token = await getBoxToken();

  if (manual) {
    const folderId = parseBoxFolderId(manual);
    if (!folderId) {
      throw new CoverPhotoSyncError(
        "That isn't a Box folder link — it should look like https://ausdilaps.app.box.com/folder/123456789"
      );
    }
    // Listing doubles as an existence and access check before anything is written.
    await listFolderItems(folderId, token);
    return { ...base, folder: { id: folderId, path: "(folder you pasted)" }, needsManualFolder: false };
  }

  const needsManual = (missingStep: string): ResolvedSurvey => ({
    ...base,
    folder: null,
    needsManualFolder: true,
    missingStep,
  });

  if (!survey[oppField]) return needsManual("this Survey has no Opportunity");
  if (!rawLink) return needsManual(`the Opportunity has no ${folderField} value`);

  const rootId = parseBoxFolderId(rawLink);
  if (!rootId) return needsManual(`the Opportunity's ${folderField} isn't a Box folder link`);

  const reports = await findChildFolder(rootId, REPORTS_FOLDER, token);
  if (!reports) return needsManual(`no "${REPORTS_FOLDER}" folder in the Opportunity's Box folder`);

  const completed = await findChildFolder(reports.id, COMPLETED_FOLDER, token);
  if (!completed) return needsManual(`no "${COMPLETED_FOLDER}" folder inside "${reports.name}"`);

  return {
    ...base,
    folder: { id: completed.id, path: `${reports.name} / ${completed.name}` },
    needsManualFolder: false,
  };
}

export interface CoverUploadResult {
  fileId: string;
  fileName: string;
  /** The DIRECT link — what gets written to Salesforce, because that is what the
   *  document-merge step has to be able to fetch as bytes. */
  sharedLink: string | null;
  /** The Box preview page. Only for the "Open in Box" link an operator clicks. */
  previewLink?: string | null;
  linkedToSurvey: boolean;
  /** Set when the file uploaded but writing the link to Salesforce failed. */
  linkError?: string;
  /** The field already held a link and was overwritten at the operator's request. */
  replacedExistingLink?: boolean;
}

/**
 * Uploads the cover photo and, optionally, writes its Box link onto the Survey.
 *
 * A failed link is reported but NOT rolled back: the file is correctly filed in Box, and
 * deleting it to "undo" would lose work over a field-permission problem the operator can fix
 * and retry. The caller surfaces `linkError` so the partial success is explicit.
 */
export async function uploadCoverPhoto(opts: {
  surveyId: string;
  folderId: string;
  filename: string;
  bytes: Uint8Array;
  linkToSurvey: boolean;
  /** The operator has been shown that the Survey already has a cover photo and has asked to
   *  replace it. Without this an occupied field is refused, so a stale resolve can never
   *  silently overwrite a colleague's link. */
  replaceExistingLink?: boolean;
}): Promise<CoverUploadResult> {
  const token = await getBoxToken();
  const file = await uploadFileAutoRenamed({
    folderId: opts.folderId,
    filename: opts.filename,
    bytes: opts.bytes,
    token,
  });

  if (!opts.linkToSurvey) {
    return { fileId: file.id, fileName: file.name, sharedLink: null, linkedToSurvey: false };
  }
  return linkCoverPhotoToSurvey(opts.surveyId, file, token, opts.replaceExistingLink === true);
}

async function linkCoverPhotoToSurvey(
  surveyId: string,
  file: { id: string; name: string },
  token: string,
  replaceExisting: boolean
): Promise<CoverUploadResult> {
  const coverField = coverPhotoField();
  try {
    // ⚠️ "open", NOT "company", and this is not a default anyone should quietly flip back.
    //
    // FormTitan fetches this URL ANONYMOUSLY when it merges the report. A "company" link
    // answers an anonymous request with HTTP 200 and Box's LOGIN PAGE — 23KB of text/html
    // where the merge expected a PNG — so the cover photo silently comes out blank. Measured
    // against a Site Markup link that merges today: that one is `access: open` and returns
    // 200 image/png, 967KB; ours was `access: company` and returned 200 text/html.
    //
    // ⚠️ A HEAD request is NOT a valid test of this. `curl -I` returns 404 for BOTH, which
    // makes an open link and a company link look identical and is exactly how this was missed
    // the first time round. Use GET and check the content-type.
    //
    // The cost is real and was weighed: an open link is readable by anyone holding the URL.
    // That is the same exposure the Site Mark Up images already carry, the URL only ever
    // travels in the Salesforce field and the merged report, and a cover photo is an aerial of
    // a property with no personal data on it.
    const link = await ensureSharedLink(file.id, token, "open");

    // The DIRECT link, not the preview page. The merge fetches whatever is in this field
    // expecting image bytes; the preview URL (app.box.com/s/...) returns an HTML viewer page,
    // which is exactly how the markup sync once produced merged documents with a broken image
    // in them. Both halves matter: the right URL FORM and the right access SCOPE. They are
    // independent, and the scope is invisible in the URL.
    const sharedLink = link.downloadUrl;
    if (!sharedLink) {
      throw new CoverPhotoSyncError(
        "Box didn't return a direct download link for that file — check that downloads are allowed on shared links for this folder. The file is uploaded either way."
      );
    }

    // Re-read at write time, not trusting the resolve step: someone else may have filled it in
    // the meantime, and overwriting a colleague's cover photo is unrecoverable.
    const [current] = await soqlQuery<SurveyRecord>(
      `SELECT Id, ${coverField} FROM Survey__c WHERE Id = '${soqlEscape(surveyId)}' LIMIT 1`
    );
    if (!current) throw new CoverPhotoSyncError("That Survey no longer exists.");
    const existing = current[coverField];
    if (isFilled(existing) && !replaceExisting) {
      throw new CoverPhotoSyncError(
        'That Survey already has a cover photo linked. Tick "replace" and sync again to overwrite it — the file is uploaded to Box either way.'
      );
    }

    await updateRecord("Survey__c", surveyId, { [coverField]: sharedLink });
    return {
      fileId: file.id,
      fileName: file.name,
      sharedLink,
      previewLink: link.url,
      linkedToSurvey: true,
      replacedExistingLink: isFilled(existing),
    };
  } catch (e) {
    return {
      fileId: file.id,
      fileName: file.name,
      sharedLink: null,
      linkedToSurvey: false,
      linkError: e instanceof Error ? e.message : String(e),
    };
  }
}
