// The enquiry list behind /admin/leads.
//
// Read-only, deliberately. `leads.status` exists in the schema and this app has never
// written it — outcomes (contacted, quoted, won, lost) are Salesforce's job, and a second
// half-maintained status field is worse than none. This page answers one question: what
// came in, and did anyone get told.

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type LeadRecord = {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  role: string | null;
  inquiryType: string | null;
  tier: string | null;
  projectName: string | null;
  projectLocation: string | null;
  assetCount: string | null;
  propertyRole: string | null;
  projectNumber: string | null;
  documentId: string | null;
  contactAddress: string | null;
  contactMethod: string[] | null;
  notes: string | null;
  sourcePage: string | null;
  /** False means the quote form saved this but the notification email never sent. */
  emailed: boolean | null;
};

export type LeadsPage = {
  leads: LeadRecord[];
  /** Total rows, so the page can say when it is showing a capped slice. */
  total: number;
  unavailable: string | null;
};

/** Enough to scroll, few enough to render as one server-side list. If the table ever
 *  outgrows this, paginate — don't just raise the number. */
const LIMIT = 200;

/** Rows written by the samples gate's email fallback. Excluded here for the same reason
 *  they are excluded from the dashboard count: a name and email left to open the sample
 *  library is a warm contact, not an enquiry, and mixing them in would make this list
 *  disagree with the tile that links to it. */
const SAMPLES_UNLOCK_ROUTING = "samples-unlock";

export async function loadLeads(): Promise<LeadsPage> {
  try {
    const db = createAdminClient();
    const { data, error, count } = await db
      .from("leads")
      .select("*", { count: "exact" })
      .neq("routing", SAMPLES_UNLOCK_ROUTING)
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (error) throw error;

    return {
      total: count ?? data?.length ?? 0,
      unavailable: null,
      leads: (data ?? []).map((r) => ({
        id: r.id as string,
        createdAt: r.created_at as string,
        name: (r.name as string) ?? "",
        email: (r.email as string) ?? "",
        phone: (r.phone as string | null) ?? null,
        company: (r.company as string | null) ?? null,
        role: (r.role as string | null) ?? null,
        inquiryType: (r.inquiry_type as string | null) ?? null,
        tier: (r.tier as string | null) ?? null,
        projectName: (r.project_name as string | null) ?? null,
        projectLocation: (r.project_location as string | null) ?? null,
        assetCount: (r.asset_count as string | null) ?? null,
        propertyRole: (r.property_role as string | null) ?? null,
        projectNumber: (r.project_number as string | null) ?? null,
        documentId: (r.document_id as string | null) ?? null,
        contactAddress: (r.contact_address as string | null) ?? null,
        contactMethod: (r.contact_method as string[] | null) ?? null,
        notes: (r.notes as string | null) ?? null,
        sourcePage: (r.source_page as string | null) ?? null,
        emailed: (r.emailed as boolean | null) ?? null,
      })),
    };
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    console.error("[admin/leads] failed to load:", message);
    return { leads: [], total: 0, unavailable: `Couldn't load enquiries: ${message}` };
  }
}
