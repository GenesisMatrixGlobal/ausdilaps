// Reading an opportunity and its work orders out of Salesforce.
//
// Read-only. The one write this tool ever makes is Closeout_Markup__c, and that lives in
// ./sync.ts so this module can be reasoned about as a pure read.

import { MarkupSyncError } from "@/lib/markup-sync";
import { lightningUrl } from "@/lib/quote-lines/resolve";
import { soqlQuery, soqlQueryAll } from "@/lib/salesforce";
import { parseSalesforceRecord, soqlEscape } from "@/lib/salesforce-links";
import { groupWorkOrders } from "./group";
import type {
  CloseoutOpportunity,
  CloseoutProperty,
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
}

export interface ResolvedCloseout {
  opportunity: CloseoutOpportunity;
  properties: CloseoutProperty[];
  unmapped: UnmappedWorkOrder[];
  skipped: SkippedWorkOrder[];
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

export async function resolveCloseout(input: string): Promise<ResolvedCloseout> {
  const id = parseOpportunityInput(input);
  const escaped = soqlEscape(id);
  const folderField = boxFolderField();

  const [opp] = await soqlQuery<OpportunityRecord>(
    `SELECT Id, Name, StageName, Account.Name, ${folderField}, ${CLOSEOUT_MARKUP_FIELD} ` +
      `FROM Opportunity WHERE Id = '${escaped}' LIMIT 1`
  );
  if (!opp) throw new MarkupSyncError(`No Opportunity found for "${id}".`);

  // ⚠️ soqlQueryAll, not soqlQuery. One opportunity in the org carries 1,913 work orders and
  // a single page stops at 2,000 — a truncated read here would under-report a job's progress
  // with nothing on screen to say so.
  const records = await soqlQueryAll<WorkOrderRecord>(
    `SELECT Id, WorkOrderNumber, Status, StatusCategory, Dilap_Stage__c, WorkType.Name, ` +
      `Street, City, State, PostalCode, Latitude, Longitude, GeocodeAccuracy ` +
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
  }));

  const { properties, unmapped, skipped } = groupWorkOrders(rows);

  return {
    opportunity: {
      id: opp.Id,
      name: opp.Name ?? opp.Id,
      stageName: opp.StageName ?? null,
      accountName: opp.Account?.Name ?? null,
      boxFolderUrl: (opp[folderField] as string | null) ?? null,
      existingMarkupUrl: opp[CLOSEOUT_MARKUP_FIELD] ?? null,
      url: lightningUrl(opp.Id, "Opportunity"),
    },
    properties,
    unmapped,
    skipped,
    // ⚠️ INSPECTIONS, not every row Salesforce returned. A billing line is not something that
    // was assessed, and counting one made the summary overstate the job.
    workOrderCount: rows.length - skipped.length,
  };
}
