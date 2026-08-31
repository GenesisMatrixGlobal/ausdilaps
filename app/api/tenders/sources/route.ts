import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isApiAdmin } from "@/lib/auth/is-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadTenderSummary } from "@/lib/tenders/summary";

/**
 * Operator controls for a discovered source.
 *
 * Sources are created automatically from sender domains, so everything about how one is
 * treated has to be adjustable without a deploy: whether it earns a gone-quiet alarm,
 * whether its mail is trusted, how its emails are parsed, and whether it runs at all.
 *
 * ADMIN ONLY, unlike the read routes which are department-gated. Reading the tender list
 * is estimating work; deciding that a sender is trusted — which is what puts its mail into
 * the forwarded digest — is not.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({
  slug: z.string().min(1).max(200),
  alertOnQuiet: z.boolean().optional(),
  isTrusted: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
  parseMode: z.enum(["auto", "digest", "single"]).optional(),
});

export async function POST(req: NextRequest) {
  if (!(await isApiAdmin())) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const { slug, ...changes } = parsed.data;

  // Only the four operator-owned fields are writable here. Health counters, timestamps and
  // last_error belong to the scanner — letting this route touch them would mean an
  // operator could silently clear the evidence of a source that is failing.
  const update: Record<string, unknown> = {};
  if (changes.alertOnQuiet !== undefined) update.alert_on_quiet = changes.alertOnQuiet;
  if (changes.isTrusted !== undefined) update.is_trusted = changes.isTrusted;
  if (changes.isEnabled !== undefined) update.is_enabled = changes.isEnabled;
  if (changes.parseMode !== undefined) update.parse_mode = changes.parseMode;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: "Nothing to change." }, { status: 400 });
  }

  try {
    const db = createAdminClient();
    const { error } = await db.from("tender_sources").update(update).eq("slug", slug);
    if (error) throw new Error(error.message);

    // Return the refreshed summary so the UI re-renders from the database rather than
    // guessing what the row now looks like.
    return NextResponse.json({ ok: true, ...(await loadTenderSummary(true)) });
  } catch (e) {
    const error = (e as Error).message;
    console.error("[tenders] source update failed:", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
