import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBearerSecret } from "@/lib/auth/shared-secret";
import { isProductionRuntime } from "@/lib/page-views";
import { measureOrigin, measurePage, PAGESPEED_TARGETS } from "@/lib/pagespeed";

/**
 * The nightly PageSpeed run — Vercel Cron at 16:00 UTC (2am Brisbane, 3am Sydney in AEDT).
 *
 * Measures every PAGESPEED_TARGETS page against the deployed site and stores the scores in
 * `pagespeed_scores` (migration 0030), which is all the Command Centre reads. This is the only
 * place a Lighthouse run happens, so no page load ever waits 10-40 seconds for one.
 *
 * Bearer only (CRON_SECRET), same as the other crons. To refresh by hand — the first scores
 * after applying 0030, say — press Run on the job under Vercel → Settings → Cron Jobs.
 *
 * No retry: a failed page keeps its last good scores with the error beside them, and
 * tomorrow's run is the retry.
 *
 * ⚠️ WRITES ON PRODUCTION ONLY (isProductionRuntime). `.env.local` points at the production
 * database and has no PAGESPEED_API_KEY, so a local run would stamp "PageSpeed 429" onto the
 * live dashboard. Anywhere else the run measures and returns the scores without saving them.
 */

export const runtime = "nodejs";
// Each Lighthouse call has a 60-second timeout and the pages run in parallel, so this is
// that plus room for the two writes.
export const maxDuration = 120;

/** A Google error can be a page of text; the dashboard shows it on one line. */
const MAX_ERROR_LENGTH = 300;

type Db = ReturnType<typeof createAdminClient>;

type Result = {
  path: string;
  measured: boolean;
  saved: boolean;
  scores?: { performance: number | null; accessibility: number | null; seo: number | null; bestPractices: number | null };
  error?: string;
};

/** Measures one page and, given a client, stores it. Never throws. */
async function measureAndStore(
  db: Db | null,
  origin: string,
  target: (typeof PAGESPEED_TARGETS)[number]
): Promise<Result> {
  const { path, label } = target;
  try {
    const score = await measurePage(label, `${origin}${path}`);
    const scores = {
      performance: score.performance,
      accessibility: score.accessibility,
      seo: score.seo,
      bestPractices: score.bestPractices,
    };
    // A 200 with no categories is not a measurement — writing it would replace good scores
    // with four dashes and call them fresh.
    const empty = Object.values(scores).every((v) => v === null);
    const failure = score.error ?? (empty ? "PageSpeed returned no scores" : null);
    const result: Result = failure
      ? { path, measured: false, saved: false, error: failure }
      : { path, measured: true, saved: false, scores };
    if (!db) return result;

    const checkedAt = new Date().toISOString();
    // ⚠️ ONE OBJECT per upsert, never an array of both shapes. PostgREST's merge-duplicates
    // updates only the columns in the payload, which is exactly what lets a failure leave
    // the last good scores and measured_at alone. An ARRAY makes supabase-js send the union
    // of every row's keys as `columns`, and a key missing from one row is then written as
    // NULL — a failure next to a success would blank the failed page's good scores.
    const row: Record<string, string | number | null> = failure
      ? { path, label, error: failure.slice(0, MAX_ERROR_LENGTH), checked_at: checkedAt }
      : {
          path,
          label,
          performance: scores.performance,
          accessibility: scores.accessibility,
          seo: scores.seo,
          best_practices: scores.bestPractices,
          measured_at: score.measuredAt ?? checkedAt,
          error: null,
          checked_at: checkedAt,
        };

    const { error } = await db.from("pagespeed_scores").upsert(row, { onConflict: "path" });
    if (error) {
      console.error(`[pagespeed] ${path}: couldn't save:`, error.message);
      return { ...result, error: `Couldn't save: ${error.message}` };
    }
    return { ...result, saved: true };
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    console.error(`[pagespeed] ${path}: failed:`, message);
    return { path, measured: false, saved: false, error: message };
  }
}

export async function GET(req: NextRequest) {
  const gate = requireBearerSecret(req, "CRON_SECRET");
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.reason }, { status: gate.status });
  }

  try {
    const site = measureOrigin();
    if ("reason" in site) {
      console.error("[pagespeed] refusing to run:", site.reason);
      return NextResponse.json({ ok: false, error: site.reason }, { status: 503 });
    }

    const write = isProductionRuntime();
    const db = write ? createAdminClient() : null;
    const results = await Promise.all(
      PAGESPEED_TARGETS.map((t) => measureAndStore(db, site.origin, t))
    );

    // 200 when every result is SAVED, even if Google failed: a failed measurement is stored
    // and shown on the dashboard. A failed save is the one thing nobody would otherwise see.
    const ok = !write || results.every((r) => r.saved);
    const measured = results.filter((r) => r.measured).length;
    console.log(
      `[pagespeed] ${measured}/${results.length} measured, ${!write ? "not production — nothing saved" : ok ? "all saved" : "SAVE FAILED"}`
    );
    return NextResponse.json(
      { ok, saved: write, origin: site.origin, measured, results },
      { status: ok ? 200 : 500 }
    );
  } catch (e) {
    const error = (e as Error).message ?? String(e);
    console.error("[pagespeed] run failed:", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
