import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBearerSecret } from "@/lib/auth/shared-secret";
import { isApiAdmin } from "@/lib/auth/is-staff";
import { getStaffUser } from "@/lib/auth/session";
import { deepgramConfigured } from "@/lib/transcription/deepgram";
import { runNightlyTick } from "@/lib/transcription/nightly/run";
import { isIsoDate } from "@/lib/transcription/nightly/dates";

// The nightly crawl — Transcription Buddy's Daily runs.
//
// GET  — Vercel Cron, every 10 minutes across the early morning (vercel.json). CRON_SECRET as a
//        bearer, which Vercel sends itself. Ticks before 4am Sydney return straight away.
// POST — an admin's "Run now" on the Daily runs tab: any past day, optionally retrying failures
//        and emailing the report to THEMSELVES only. Never sends the team report or an
//        inspector email (see maybeReport in lib/transcription/nightly/run.ts).
//
// ⚠️ GET takes the bearer alone, never the session cookie — the Tender Watch rule: SameSite=Lax
// cookies ride on a top-level GET, so a link an admin clicked would start a run.

export const runtime = "nodejs";
export const maxDuration = 290;

export async function GET(req: NextRequest) {
  const gate = requireBearerSecret(req, "CRON_SECRET");
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.reason }, { status: gate.status });
  if (!deepgramConfigured()) return NextResponse.json({ ok: false, error: "DEEPGRAM_API_KEY not set." }, { status: 503 });
  try {
    return NextResponse.json({ ok: true, ...(await runNightlyTick({ trigger: "cron" })) });
  } catch (e) {
    console.error("[transcription/nightly]", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

const bodySchema = z.object({
  date: z.string().refine(isIsoDate, "Not a date."),
  retryFailed: z.boolean().optional(),
  emailMe: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  if (!(await isApiAdmin())) return NextResponse.json({ ok: false, error: "Admins only." }, { status: 401 });
  if (!deepgramConfigured()) return NextResponse.json({ ok: false, error: "Transcription is not configured on this environment (DEEPGRAM_API_KEY)." }, { status: 503 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid input." }, { status: 400 });
  const user = parsed.data.emailMe ? await getStaffUser() : null;
  try {
    const result = await runNightlyTick({
      trigger: "manual",
      date: parsed.data.date,
      retryFailed: parsed.data.retryFailed,
      reportTo: user?.email ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
