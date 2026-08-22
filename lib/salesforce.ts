// Salesforce client — OAuth 2.0 client-credentials flow (no user login; requests run as
// the Connected App's configured run-as user).
//
// Two callers with deliberately different error contracts:
//   - `syncLeadToSalesforce` is best-effort and gated behind SF_SYNC_ENABLED. It never
//     throws; a failed sync must not stop a website lead being saved.
//   - `soqlQuery` / `updateRecord` throw with Salesforce's own error text. They back the
//     operator-initiated Sync To Salesforce button, where whoever clicked needs to see
//     exactly what went wrong.

import type { LeadTier } from "@/lib/leads";

export class SalesforceConfigError extends Error {}

interface SalesforceSession {
  token: string;
  instanceUrl: string;
  apiVersion: string;
}

/** Throws SalesforceConfigError when credentials are absent, so callers can tell
 *  "not set up yet" apart from "Salesforce said no". */
async function getAccessToken(): Promise<SalesforceSession> {
  const clientId = process.env.SF_CLIENT_ID;
  const clientSecret = process.env.SF_CLIENT_SECRET;
  const loginUrl = process.env.SF_LOGIN_URL ?? "https://login.salesforce.com";
  const apiVersion = process.env.SF_API_VERSION ?? "v60.0";

  if (!clientId || !clientSecret) {
    throw new SalesforceConfigError(
      "Salesforce isn't configured — set SF_CLIENT_ID and SF_CLIENT_SECRET."
    );
  }

  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    // Surface Salesforce's own error verbatim. The two failures here need opposite fixes and
    // look identical without it: `invalid_client` means the Consumer Secret is wrong, while
    // `invalid_grant` means the External Client App's client-credentials flow isn't enabled
    // (or has no Run As user). Both come back as a bare 400.
    const body = await res.text().catch(() => "");
    let detail = body.slice(0, 200);
    try {
      const parsed = JSON.parse(body) as { error?: string; error_description?: string };
      if (parsed.error) {
        detail = [parsed.error, parsed.error_description].filter(Boolean).join(": ");
      }
    } catch {
      // Not JSON — the truncated body is the best detail available.
    }
    throw new Error(`Salesforce token request failed (${res.status}): ${detail}`);
  }

  const token = (await res.json()) as { access_token?: string; instance_url?: string };
  if (!token.access_token || !token.instance_url) {
    throw new Error("Salesforce token response was missing access_token or instance_url");
  }
  return { token: token.access_token, instanceUrl: token.instance_url, apiVersion };
}

/** Salesforce reports errors as an array of {errorCode, message}. Surface them verbatim —
 *  an INVALID_FIELD naming the field is exactly what's needed to correct a configured API
 *  name, so flattening it into something generic would throw away the fix. */
async function salesforceError(res: Response, context: string): Promise<Error> {
  const body = await res.text().catch(() => "");
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { message?: string; errorCode?: string }[];
    if (Array.isArray(parsed) && parsed[0]?.message) {
      detail = parsed.map((e) => [e.errorCode, e.message].filter(Boolean).join(": ")).join("; ");
    }
  } catch {
    // Not JSON — the truncated body is the best detail available.
  }
  return new Error(`${context} failed (${res.status}): ${detail}`);
}

export async function soqlQuery<T>(soql: string): Promise<T[]> {
  const { token, instanceUrl, apiVersion } = await getAccessToken();
  const url = new URL(`${instanceUrl}/services/data/${apiVersion}/query`);
  url.searchParams.set("q", soql);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw await salesforceError(res, "Salesforce query");

  const data = (await res.json()) as { records?: T[] };
  return data.records ?? [];
}

export async function updateRecord(
  sobject: string,
  id: string,
  fields: Record<string, unknown>
): Promise<void> {
  const { token, instanceUrl, apiVersion } = await getAccessToken();
  const res = await fetch(`${instanceUrl}/services/data/${apiVersion}/sobjects/${sobject}/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(fields),
    cache: "no-store",
  });
  // A successful PATCH is 204 No Content.
  if (!res.ok) throw await salesforceError(res, `Salesforce update of ${sobject}`);
}

export type SalesforceLead = {
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  role?: string | null;
  projectName?: string | null;
  projectLocation?: string | null;
  notes?: string | null;
  tier: LeadTier;
  inquiryType?: string | null;
  propertyRole?: string | null;
  projectNumber?: string | null;
  documentId?: string | null;
  contactAddress?: string | null;
  contactMethod?: string[] | null;
};

export async function syncLeadToSalesforce(
  lead: SalesforceLead
): Promise<{ id?: string; error?: string }> {
  // Everything inside the try, so a config or token failure comes back as {error} rather
  // than propagating — this path must never block a lead from being saved.
  try {
    const { token, instanceUrl, apiVersion } = await getAccessToken();

    const parts = lead.name.trim().split(/\s+/);
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : lead.name;
    const firstName = parts.length > 1 ? parts[0] : undefined;

    const res = await fetch(
      `${instanceUrl}/services/data/${apiVersion}/sobjects/Lead`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(firstName && { FirstName: firstName }),
          LastName: lastName,
          Company: lead.company || "Residential enquiry",
          Email: lead.email,
          ...(lead.phone && { Phone: lead.phone }),
          ...(lead.role && { Title: lead.role }),
          LeadSource: "Website — Quote form",
          Rating: lead.tier === "tier1" ? "Hot" : lead.tier === "tier2" ? "Warm" : "Cold",
          Description: [
            lead.inquiryType && `Inquiry type: ${lead.inquiryType}`,
            lead.projectName && `Project: ${lead.projectName}`,
            lead.projectLocation && `Location: ${lead.projectLocation}`,
            lead.propertyRole && `Property role: ${lead.propertyRole}`,
            lead.projectNumber && `Project/OPT number: ${lead.projectNumber}`,
            lead.documentId && `Document ID: ${lead.documentId}`,
            lead.contactAddress && `Address: ${lead.contactAddress}`,
            lead.contactMethod?.length && `Preferred contact: ${lead.contactMethod.join(", ")}`,
            `Tier: ${lead.tier}`,
            lead.notes && `Notes: ${lead.notes}`,
          ]
            .filter(Boolean)
            .join("\n"),
        }),
      }
    );
    const data = (await res.json()) as { id?: string };
    if (!res.ok) return { error: `SF lead ${res.status}` };
    return { id: data.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
