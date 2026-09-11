// Email fallback for the samples gate: name + email in, cookie + redirect out, and the
// enquiry lands in `leads` so someone can follow it up. Form-encoded POST from a plain
// <form> — no JavaScript needed on the page.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SAMPLES_COOKIE,
  SAMPLES_COOKIE_OPTIONS,
  SAMPLES_PATH,
  gateEnabled,
  unlockCookieValue,
} from "@/lib/samples-access";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  company: z.string().trim().max(200).optional().default(""),
  company_website: z.string().optional().default(""), // honeypot
});

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const raw = form
    ? Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]))
    : {};
  const parsed = schema.safeParse(raw);

  const back = new URL(SAMPLES_PATH, req.url);
  if (!parsed.success) {
    back.searchParams.set("error", "email");
    return NextResponse.redirect(back, 303);
  }
  const d = parsed.data;

  // A filled honeypot is a bot. Pretend it worked, set no cookie, record nothing.
  if (d.company_website) return NextResponse.redirect(back, 303);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  // Best effort, never blocking: the visitor gets the library whether or not the row
  // saves or the email sends. Failing them over our plumbing would be the wrong trade.
  let leadId: string | null = null;
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("leads")
      .insert({
        name: d.name,
        email: d.email,
        company: d.company || null,
        source_page: SAMPLES_PATH,
        notes: "Opened the sample report library with their email (no access code).",
        routing: "samples-unlock",
        ip,
        user_agent: userAgent,
      })
      .select("id")
      .single();
    if (error) throw error;
    leadId = data.id;
  } catch (e) {
    console.error("[samples/unlock] lead insert failed:", e);
  }

  try {
    await notify(d, leadId);
  } catch (e) {
    console.error("[samples/unlock] notify failed:", e);
  }

  const res = NextResponse.redirect(back, 303);
  if (gateEnabled()) {
    const value = await unlockCookieValue();
    if (value) res.cookies.set(SAMPLES_COOKIE, value, SAMPLES_COOKIE_OPTIONS);
  }
  return res;
}

async function notify(d: z.infer<typeof schema>, leadId: string | null) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const from = process.env.RESEND_FROM_EMAIL ?? "AusDilaps <no-reply@ausdilaps.com.au>";
  const to = process.env.SALES_NOTIFY_EMAIL || process.env.ADMIN_EMAIL || "info@ausdilaps.com.au";
  const when = new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Brisbane",
  }).format(new Date());

  const html = `
    <p>Someone opened the <strong>sample report library</strong> with their email instead of an access code — a warm lead worth a call.</p>
    <table cellpadding="4" style="border-collapse:collapse">
      <tr><td><strong>Name</strong></td><td>${esc(d.name)}</td></tr>
      <tr><td><strong>Email</strong></td><td><a href="mailto:${esc(d.email)}">${esc(d.email)}</a></td></tr>
      <tr><td><strong>Company</strong></td><td>${esc(d.company || "—")}</td></tr>
      <tr><td><strong>When</strong></td><td>${esc(when)} (Brisbane)</td></tr>
      <tr><td><strong>Lead id</strong></td><td>${esc(leadId ?? "not saved")}</td></tr>
    </table>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: to.split(",").map((s) => s.trim()).filter(Boolean),
      subject: `Sample library opened — ${d.name}${d.company ? ` (${d.company})` : ""}`,
      html,
    }),
  });
}
