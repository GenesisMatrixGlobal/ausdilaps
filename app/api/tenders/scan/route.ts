import { NextRequest, NextResponse } from "next/server";
import { requireBearerSecret } from "@/lib/auth/shared-secret";
import { isApiAdmin } from "@/lib/auth/is-staff";
import { runScan } from "@/lib/tenders/scan";

/**
 * The nightly scan.
 *
 * GET  — Vercel Cron. Authenticated by CRON_SECRET as a bearer token, which Vercel sends
 *        automatically once the env var is set on the project.
 * POST — the "Run scan now" button in the tool, authenticated by an admin session.
 *
 * One route, two entry points, one runScan(). The manual path costs nothing extra and
 * satisfies the repo convention that tool components always POST.
 *
 * Replay honesty: Vercel Cron sends a STATIC bearer, so a captured header is replayable by
 * definition. Rather than pretend otherwise, the compensating controls are: every write in
 * the scan is idempotent, a cron start is refused if a run began in the last 10 minutes,
 * and TENDER_MAX_CLASSIFY_PER_RUN caps spend per invocation. Someone holding the secret can
 * make the scan run; they cannot make it cost unbounded money or send unbounded email.
 */

export const runtime = "nodejs";
export const maxDuration = 290;

async function handle(req: NextRequest, triggeredBy: "cron" | "manual") {
  const gate = requireBearerSecret(req, "CRON_SECRET");

  if (!gate.ok) {
    // A 503 means the secret is missing or too weak. That is a deployment fault, not a
    // rejected caller, and it must NOT fall through to "well, maybe an admin is calling" —
    // the endpoint stays shut until it is configured properly.
    if (gate.status === 503) {
      return NextResponse.json({ ok: false, error: gate.reason }, { status: 503 });
    }
    // A 401 on the bearer path can still be a signed-in admin pressing the button.
    if (!(await isApiAdmin())) {
      return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
    }
  }

  // ?days=N widens the window for a one-off backfill. Costs nothing beyond the extra
  // Graph pages: an item already stored is matched on its external_ref and never
  // re-classified, so re-reading old mail re-reads judgements we have already paid for.
  const requested = Number(req.nextUrl.searchParams.get("days"));
  const lookbackDays = Number.isFinite(requested) && requested > 0 ? requested : undefined;

  try {
    const summary = await runScan({ triggeredBy, lookbackDays });
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    const error = (e as Error).message;
    console.error("[tenders] scan failed:", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req, "cron");
}

export async function POST(req: NextRequest) {
  return handle(req, "manual");
}
