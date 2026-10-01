import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRecords } from "@/lib/salesforce";
import { generateHandoffCode } from "./handoff-code";
import { parseLocality } from "./salesforce-match";
import type { HandoffItem } from "./notify";

/**
 * Allocating the code a staff member types into the New Opportunity flow, and pushing the
 * snapshot to Salesforce for that flow to read.
 *
 * ── The object, and why its field names are env-overridable ───────────────────────────────
 *
 * `Tender_Watch_Item__c` is created by hand in Setup, so the API names here are an agreement
 * with the org rather than something this repo controls. They follow the pattern already used
 * for the cover photo's Survey fields: a default that matches what was agreed, overridable
 * without a deploy if the org names one differently.
 */
export const TW_OBJECT = process.env.SF_TENDER_OBJECT ?? "Tender_Watch_Item__c";

const F = {
  name: "Name", // the code itself — TW-4F7K2
  project: process.env.SF_TENDER_PROJECT_FIELD ?? "Project_Name__c",
  street: process.env.SF_TENDER_STREET_FIELD ?? "Site_Street__c",
  city: process.env.SF_TENDER_CITY_FIELD ?? "Site_City__c",
  state: process.env.SF_TENDER_STATE_FIELD ?? "Site_State__c",
  postcode: process.env.SF_TENDER_POSTCODE_FIELD ?? "Site_Postcode__c",
  client: process.env.SF_TENDER_CLIENT_FIELD ?? "Client_Name__c",
  contactName: process.env.SF_TENDER_CONTACT_NAME_FIELD ?? "Contact_Name__c",
  contactEmail: process.env.SF_TENDER_CONTACT_EMAIL_FIELD ?? "Contact_Email__c",
  closes: process.env.SF_TENDER_CLOSES_FIELD ?? "Submission_Due_Date__c",
  url: process.env.SF_TENDER_URL_FIELD ?? "Vendor_Portal_Link__c",
  ref: process.env.SF_TENDER_REF_FIELD ?? "Portal_Ref__c",
  source: process.env.SF_TENDER_SOURCE_FIELD ?? "Source__c",
  summary: process.env.SF_TENDER_SUMMARY_FIELD ?? "Summary__c",
};

export type HandoffRecord = {
  code: string;
  groupKey: string;
  projectName: string;
};

/** A date as Salesforce wants it, or null. */
function sfDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * The code for this opportunity, minting one on first use.
 *
 * ⚠️ Keyed on the GROUP, and idempotent, which is what stops a preview-to-yourself burning a
 * code the real send then can't reuse — the email would show one code and Salesforce hold
 * another. A re-send after a correction reuses it for the same reason.
 *
 * ⚠️ Never throws. A handoff email going out WITHOUT a code is a worse outcome than one with
 * a code, but both are far better than the send failing: the email is the deliverable, and
 * everything here is a convenience on top of it.
 */
export async function allocateHandoff(
  item: HandoffItem,
  groupKey: string,
  userId: string | null
): Promise<HandoffRecord | null> {
  try {
    const db = createAdminClient();

    const { data: existing, error: readError } = await db
      .from("tender_handoffs")
      .select("code, group_key, project_name")
      .eq("group_key", groupKey)
      .maybeSingle();
    if (readError) throw readError;
    if (existing) {
      return {
        code: existing.code as string,
        groupKey: existing.group_key as string,
        projectName: existing.project_name as string,
      };
    }

    // The site is stored split, because Opportunity.Site_Address__c is a COMPOUND field and
    // is not createable — the flow has to write Site_Address__Street__s / __City__s /
    // __StateCode__s individually, so handing it one blob would just move the parsing.
    const locality = parseLocality(item.siteLocation);

    const row = {
      code: generateHandoffCode(),
      group_key: groupKey,
      item_ids: item.ids,
      project_name: item.title.slice(0, 255),
      site_street: item.siteLocation?.slice(0, 255) ?? null,
      site_city: locality?.suburb ?? null,
      site_state: locality?.state ?? null,
      site_postcode: null,
      client_name: item.agency?.slice(0, 255) ?? null,
      contact_name: item.contact?.slice(0, 255) ?? null,
      contact_email: item.emailFrom?.slice(0, 255) ?? null,
      closes_at: item.closesAt,
      portal_url: item.sources.find((s) => s.url)?.url ?? null,
      portal_ref: item.sources[0]?.label ?? null,
      source_label: item.sources.map((s) => s.label).join(", ").slice(0, 255),
      summary: item.summary?.slice(0, 2000) ?? null,
      created_by: userId,
    };

    const { data, error } = await db
      .from("tender_handoffs")
      .insert(row)
      .select("code, group_key, project_name")
      .single();
    // A concurrent send can lose the race on the unique index; the other one's code is the
    // right answer, not an error.
    if (error) {
      const { data: raced } = await db
        .from("tender_handoffs")
        .select("code, group_key, project_name")
        .eq("group_key", groupKey)
        .maybeSingle();
      if (!raced) throw error;
      return {
        code: raced.code as string,
        groupKey: raced.group_key as string,
        projectName: raced.project_name as string,
      };
    }

    return {
      code: data.code as string,
      groupKey: data.group_key as string,
      projectName: data.project_name as string,
    };
  } catch (e) {
    console.error("[tenders] could not allocate a handoff code:", (e as Error).message);
    return null;
  }
}

/**
 * Push the allocated codes into Salesforce so the flow can find them.
 *
 * Runs AFTER the email has been sent, and never throws: until `Tender_Watch_Item__c` exists
 * in the org this fails every time, and that must not stop a handoff going out. The error is
 * recorded on the row so `/admin/tenders` can show which ones still need a retry.
 */
export async function pushHandoffsToSalesforce(codes: string[]): Promise<void> {
  if (codes.length === 0) return;
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("tender_handoffs")
      .select("*")
      .in("code", codes)
      .is("salesforce_id", null);
    if (error) throw error;
    const rows = data ?? [];
    if (rows.length === 0) return;

    const records = rows.map((r) => ({
      [F.name]: r.code,
      [F.project]: r.project_name,
      [F.street]: r.site_street,
      [F.city]: r.site_city,
      [F.state]: r.site_state,
      [F.postcode]: r.site_postcode,
      [F.client]: r.client_name,
      [F.contactName]: r.contact_name,
      [F.contactEmail]: r.contact_email,
      [F.closes]: sfDate(r.closes_at as string | null),
      [F.url]: r.portal_url,
      [F.ref]: r.portal_ref,
      [F.source]: r.source_label,
      [F.summary]: r.summary,
    }));

    const created = await createRecords(TW_OBJECT, records);
    const now = new Date().toISOString();
    await Promise.all(
      rows.map((r, i) =>
        db
          .from("tender_handoffs")
          .update({ salesforce_id: created[i]?.id ?? null, sf_synced_at: now, sf_error: null })
          .eq("code", r.code)
      )
    );
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    console.error("[tenders] handoff push to Salesforce failed:", message);
    try {
      const db = createAdminClient();
      await db.from("tender_handoffs").update({ sf_error: message }).in("code", codes).is("salesforce_id", null);
    } catch {
      /* the email already went; this is the last thing worth failing over */
    }
  }
}
