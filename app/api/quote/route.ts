import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { quoteSchema, classifyTier, type QuoteInput, type LeadTier } from "@/lib/leads";
import { syncLeadToSalesforce } from "@/lib/salesforce";
import { SITE } from "@/lib/site";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function verifyTurnstile(secret: string, token: string, ip: string | null) {
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
    });
    const data = (await res.json()) as { success?: boolean };
    return !!data.success;
  } catch {
    return false;
  }
}

async function sendEmails(d: QuoteInput, tier: LeadTier, testMode: boolean) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const from = process.env.RESEND_FROM_EMAIL ?? "AusDilaps <no-reply@ausdilaps.com.au>";
  const adminEmail = process.env.ADMIN_EMAIL ?? "info@ausdilaps.com.au";
  const salesNotify = process.env.SALES_NOTIFY_EMAIL;

  const rows: [string, string | number | undefined][] = [
    ["Inquiry type", d.inquiryType],
    ["Name", d.name],
    ["Role", d.role],
    ["Company", d.company],
    ["Email", d.email],
    ["Phone", d.phone],
    ["Project", d.projectName],
    ["Location", d.projectLocation],
    ["Approx. assets requiring inspection", d.assetCount],
    ["Property role", d.propertyRole],
    ["Project / OPT number", d.projectNumber],
    ["Document ID", d.documentId],
    ["Address", d.contactAddress],
    ["Preferred contact", d.contactMethod?.join(", ")],
    ["Tier", tier],
  ];
  const tableRows = rows
    .filter(([, v]) => v !== undefined && v !== "" && v !== null)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 0;color:#5b6570;width:170px;">${k}</td><td style="padding:8px 0;font-weight:600;color:#2f343a;">${esc(String(v))}</td></tr>`
    )
    .join("");

  const send = async (payload: Record<string, unknown>) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("[quote] resend send failed:", res.status, await res.text());
      return false;
    }
    return true;
  };

  // Admin notice
  const adminSent = await send({
    from,
    to: [adminEmail],
    ...(tier === "tier1" && salesNotify ? { cc: [salesNotify] } : {}),
    reply_to: d.email,
    subject: `New quote — ${d.name}${d.company ? ` (${d.company})` : ""}${tier === "tier1" ? " · TIER 1" : ""}`,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;color:#2f343a;">
      <h2 style="margin:0 0 20px;">New quote request — ausdilaps.com.au</h2>
      <table style="width:100%;border-collapse:collapse;">${tableRows}</table>
      ${d.notes ? `<div style="margin-top:20px;padding-top:20px;border-top:1px solid #eee;"><p style="color:#5b6570;margin:0 0 8px;">Notes</p><p style="white-space:pre-wrap;">${esc(d.notes)}</p></div>` : ""}
    </div>`,
  });

  // Acknowledgement (routed to admin in test mode)
  const firstName = d.name.split(" ")[0];
  const ackSent = await send({
    from,
    to: [testMode ? adminEmail : d.email],
    reply_to: adminEmail,
    subject: "We've received your quote request — AusDilaps",
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#2f343a;">
      <div style="background:#23272b;padding:28px 36px;">
        <p style="color:#6d90b4;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 6px;">AusDilaps · Specialist Building Inspections</p>
        <p style="color:#ffffff;font-size:18px;font-weight:700;margin:0;">Quote request received.</p>
      </div>
      <div style="padding:36px;">
        <p style="margin-top:0;">Hi ${esc(firstName)},</p>
        <p style="line-height:1.7;">Thanks for your enquiry. We've received the details of your project and will scope it and come back to you shortly.</p>
        <p style="line-height:1.7;">If it's urgent, call us on <strong>${SITE.phone}</strong> or reply to this email.</p>
        <p style="color:#5b6570;font-size:14px;margin-bottom:0;">— The AusDilaps team</p>
      </div>
      <div style="border-top:1px solid #e5e7eb;padding:20px 36px;">
        <p style="color:#9ca3af;font-size:12px;margin:0;">AusDilaps · ausdilaps.com.au · Reports compliant with ${SITE.standard}</p>
      </div>
    </div>`,
  });
  return adminSent && ackSent;
}

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const parsed = quoteSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, errors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const d = parsed.data;

  // Honeypot — silently accept and drop bots.
  if (d.company_website) return NextResponse.json({ ok: true });

  // Turnstile (only enforced when configured).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const tsSecret = process.env.TURNSTILE_SECRET_KEY;
  if (tsSecret) {
    const ok = await verifyTurnstile(tsSecret, d.turnstileToken, ip);
    if (!ok) {
      return NextResponse.json(
        { ok: false, errors: { turnstileToken: ["Verification failed — please try again."] } },
        { status: 400 }
      );
    }
  }

  const tier = classifyTier(d);
  const testMode = process.env.LEAD_TEST_MODE === "true";
  const userAgent = req.headers.get("user-agent") ?? null;

  const row = {
    inquiry_type: d.inquiryType,
    name: d.name,
    email: d.email,
    phone: d.phone || null,
    role: d.role || null,
    company: d.company || null,
    project_name: d.projectName || null,
    project_location: d.projectLocation || null,
    asset_count: d.assetCount || null,
    property_role: d.propertyRole || null,
    project_number: d.projectNumber || null,
    document_id: d.documentId || null,
    contact_address: d.contactAddress || null,
    contact_method: d.contactMethod?.length ? d.contactMethod : null,
    notes: d.notes || null,
    tier,
    routing: tier === "tier1" ? "priority" : "standard",
    source_page: d.sourcePage || null,
    ip,
    user_agent: userAgent,
  };

  // Persist (source of truth).
  const hasSupabase = !!(
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)
  );
  let leadId: string | null = null;
  if (hasSupabase) {
    try {
      const db = createAdminClient();
      const { data, error } = await db.from("leads").insert(row).select("id").single();
      if (error) throw error;
      leadId = data.id as string;
    } catch (e) {
      console.error("[quote] supabase insert failed:", e);
      return NextResponse.json(
        { ok: false, error: `We couldn't save your request. Please call us on ${SITE.phone}.` },
        { status: 500 }
      );
    }
  } else {
    console.warn("[quote] Supabase not configured — lead not persisted:", row);
  }

  // Email (best-effort, never blocks).
  let emailed = false;
  try {
    emailed = await sendEmails(d, tier, testMode);
  } catch (e) {
    console.error("[quote] email failed:", e);
  }

  // Salesforce (best-effort, gated, skipped in test mode).
  let sf: { id?: string; error?: string } | null = null;
  if (!testMode && process.env.SF_SYNC_ENABLED === "true") {
    sf = await syncLeadToSalesforce({
      name: d.name,
      email: d.email,
      phone: d.phone,
      company: d.company,
      role: d.role,
      projectName: d.projectName,
      projectLocation: d.projectLocation,
      notes: d.notes,
      tier,
      inquiryType: d.inquiryType,
      propertyRole: d.propertyRole,
      projectNumber: d.projectNumber,
      documentId: d.documentId,
      contactAddress: d.contactAddress,
      contactMethod: d.contactMethod,
    });
  }

  // Record delivery outcomes (best-effort).
  if (hasSupabase && leadId && (emailed || sf)) {
    try {
      await createAdminClient()
        .from("leads")
        .update({
          emailed,
          salesforce_id: sf?.id ?? null,
          salesforce_synced: !!sf?.id,
          sync_error: sf?.error ?? null,
        })
        .eq("id", leadId);
    } catch (e) {
      console.error("[quote] flag update failed:", e);
    }
  }

  return NextResponse.json({ ok: true });
}
