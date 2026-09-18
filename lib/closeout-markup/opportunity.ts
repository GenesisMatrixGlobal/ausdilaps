// Reading an opportunity and its work orders out of Salesforce.
//
// Read-only. The one write this tool ever makes is Closeout_Markup__c, and that lives in
// ./sync.ts so this module can be reasoned about as a pure read.

import { MarkupSyncError } from "@/lib/markup-sync";
import { lightningUrl } from "@/lib/quote-lines/resolve";
import { soqlQuery, soqlQueryAll } from "@/lib/salesforce";
import { parseSalesforceRecord, soqlEscape } from "@/lib/salesforce-links";
import { groupWorkOrders } from "./group";
import { siteAddressFrom } from "./site";
import type {
  CloseoutOpportunity,
  CloseoutProperty,
  CouncilAsset,
  SkippedWorkOrder,
  UnmappedWorkOrder,
  WorkOrderRow,
} from "./types";

/** The Opportunity field holding the Box folder — shared with the markup sync, which reads the
 *  same env var, so a renamed field is fixed in one place. */
function boxFolderField(): string {
  return process.env.SF_OPPORTUNITY_BOX_FOLDER_FIELD ?? "Link_to_Box_Files__c";
}

/** Where a finished closeout markup is filed. A URL field on Opportunity, beside
 *  Closeout_Letter_Link__c — this drawing goes out with the closeout letter. */
export const CLOSEOUT_MARKUP_FIELD = "Closeout_Markup__c";

interface OpportunityRecord {
  Id: string;
  Name?: string | null;
  StageName?: string | null;
  Account?: { Name?: string | null } | null;
  Closeout_Markup__c?: string | null;
  Site_Address__Street__s?: string | null;
  Site_Address__City__s?: string | null;
  Site_Address__StateCode__s?: string | null;
  Site_Address__PostalCode__s?: string | null;
  [field: string]: unknown;
}

interface WorkOrderRecord {
  Id: string;
  WorkOrderNumber?: string | null;
  Status?: string | null;
  StatusCategory?: string | null;
  Dilap_Stage__c?: string | null;
  WorkType?: { Name?: string | null } | null;
  Street?: string | null;
  City?: string | null;
  State?: string | null;
  PostalCode?: string | null;
  Latitude?: number | null;
  Longitude?: number | null;
  GeocodeAccuracy?: string | null;
  Site_Mark_Ups__c?: string | null;
}

export interface ResolvedCloseout {
  opportunity: CloseoutOpportunity;
  properties: CloseoutProperty[];
  unmapped: UnmappedWorkOrder[];
  skipped: SkippedWorkOrder[];
  councilAssets: CouncilAsset[];
  /** Work orders that WERE inspections — the denominator the sheet shows. Excludes `skipped`. */
  workOrderCount: number;
}

/**
 * An Opportunity Id out of whatever was pasted.
 *
 * Unlike the Quote box, this one takes an Id or a URL and nothing else. A Quote has a
 * QuoteNumber that a human reads off a document; an Opportunity's equivalent is its Name, and
 * matching a free-text name would either find several jobs or the wrong one — on a set of
 * records called `PRE OPT-34851 …` and `POST OPT-34952 …` that is a real risk, and picking the
 * wrong job would produce a confident, completely wrong drawing.
 */
export function parseOpportunityInput(input: string): string {
  const ref = parseSalesforceRecord(input);
  if (!ref) {
    throw new MarkupSyncError("Paste the Salesforce Opportunity link, or its record Id.");
  }
  if (ref.object && ref.object !== "Opportunity") {
    throw new MarkupSyncError(
      `That link points at a ${ref.object}, not an Opportunity. Open the Opportunity and copy its link.`
    );
  }
  return ref.id;
}

/**
 * Cover photos, by work order id.
 *
 * `Survey__c.Work_Order__c` is the link, and `Cover_Photo_URL__c` is a Box shared link to a
 * .png/.jpg — the report cover, with the council asset drawn on it. 11,736 surveys carry one.
 *
 * Chunked because a SOQL statement has a length limit and a big job could name hundreds of
 * work orders. Never throws: a reference image is a convenience, and losing it should cost the
 * operator a link, not the whole closeout.
 */
async function coverPhotosFor(workOrderIds: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const CHUNK = 200;
  for (let i = 0; i < workOrderIds.length; i += CHUNK) {
    const ids = workOrderIds.slice(i, i + CHUNK).map((id) => `'${soqlEscape(id)}'`).join(",");
    if (!ids) continue;
    try {
      const rows = await soqlQueryAll<{ Work_Order__c: string; Cover_Photo_URL__c: string }>(
        `SELECT Work_Order__c, Cover_Photo_URL__c FROM Survey__c ` +
          `WHERE Work_Order__c IN (${ids}) AND Cover_Photo_URL__c != null`
      );
      // A work order can have several surveys; the first with a cover photo is enough to look at.
      for (const r of rows) if (!found.has(r.Work_Order__c)) found.set(r.Work_Order__c, r.Cover_Photo_URL__c);
    } catch {
      // Leave the links off rather than failing the resolve.
    }
  }
  return found;
}

export async function resolveCloseout(input: string): Promise<ResolvedCloseout> {
  const id = parseOpportunityInput(input);
  const escaped = soqlEscape(id);
  const folderField = boxFolderField();

  const [opp] = await soqlQuery<OpportunityRecord>(
    `SELECT Id, Name, StageName, Account.Name, ${folderField}, ${CLOSEOUT_MARKUP_FIELD}, ` +
      // The project site. A compound Address field, so its components are read individually —
      // and ⚠️ it carries NO Latitude/Longitude: the org geocodes WorkOrder.Address, not this
      // one, so the site is the one thing here that needs a Google lookup. See ./site.ts.
      `Site_Address__Street__s, Site_Address__City__s, Site_Address__StateCode__s, Site_Address__PostalCode__s ` +
      `FROM Opportunity WHERE Id = '${escaped}' LIMIT 1`
  );
  if (!opp) throw new MarkupSyncError(`No Opportunity found for "${id}".`);

  // ⚠️ soqlQueryAll, not soqlQuery. One opportunity in the org carries 1,913 work orders and
  // a single page stops at 2,000 — a truncated read here would under-report a job's progress
  // with nothing on screen to say so.
  const records = await soqlQueryAll<WorkOrderRecord>(
    `SELECT Id, WorkOrderNumber, Status, StatusCategory, Dilap_Stage__c, WorkType.Name, ` +
      `Street, City, State, PostalCode, Latitude, Longitude, GeocodeAccuracy, Site_Mark_Ups__c ` +
      `FROM WorkOrder WHERE Opportunity__c = '${escaped}'`
  );

  const rows: WorkOrderRow[] = records.map((r) => ({
    id: r.Id,
    number: r.WorkOrderNumber ?? null,
    status: r.Status ?? null,
    statusCategory: r.StatusCategory ?? null,
    stage: r.Dilap_Stage__c ?? null,
    workType: r.WorkType?.Name ?? null,
    street: r.Street ?? null,
    city: r.City ?? null,
    state: r.State ?? null,
    postalCode: r.PostalCode ?? null,
    latitude: r.Latitude ?? null,
    longitude: r.Longitude ?? null,
    geocodeAccuracy: r.GeocodeAccuracy ?? null,
    siteMarkupUrl: r.Site_Mark_Ups__c ?? null,
  }));

  const { properties, unmapped, skipped, councilAssets } = groupWorkOrders(rows);

  // Reference images, and ONLY for the rows that need one: the council assets and anything the
  // tool could not place. Both are drawn by hand, so both need something to draw from; every
  // other row already has its boundary. Asking for every survey on a 1,900-work-order job would
  // be a large read for something nothing uses.
  //
  // After grouping, not before, because "could not be placed" is grouping's answer.
  const coverPhotos = await coverPhotosFor([
    ...councilAssets.map((c) => c.workOrderId),
    ...unmapped.map((u) => u.id),
  ]);
  for (const c of councilAssets) c.coverPhotoUrl = coverPhotos.get(c.workOrderId) ?? null;
  for (const u of unmapped) u.coverPhotoUrl = coverPhotos.get(u.id) ?? null;

  return {
    opportunity: {
      id: opp.Id,
      name: opp.Name ?? opp.Id,
      stageName: opp.StageName ?? null,
      accountName: opp.Account?.Name ?? null,
      boxFolderUrl: (opp[folderField] as string | null) ?? null,
      existingMarkupUrl: opp[CLOSEOUT_MARKUP_FIELD] ?? null,
      url: lightningUrl(opp.Id, "Opportunity"),
      siteAddress: siteAddressFrom(
        opp.Site_Address__Street__s ?? null,
        opp.Site_Address__City__s ?? null,
        opp.Site_Address__StateCode__s ?? null,
        opp.Site_Address__PostalCode__s ?? null
      ),
    },
    properties,
    unmapped,
    skipped,
    councilAssets,
    // ⚠️ INSPECTIONS, not every row Salesforce returned. A billing line is not something that
    // was assessed, and counting one made the summary overstate the job.
    workOrderCount: rows.length - skipped.length,
  };
}
