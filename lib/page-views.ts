// Page-view recording and read-back for the samples library (migration 0015).
//
// Mirrors lib/tools/usage.ts: NEVER throws, never blocks the caller. Callers hand
// recordPageView() to `after()` from next/server so the function stays alive until the
// insert settles — a bare fire-and-forget promise can be killed the moment the response
// is sent.

import { createAdminClient } from "@/lib/supabase/admin";

export type PageViewEvent =
  | "view_locked"
  | "view_library"
  | "unlock_code"
  | "unlock_code_failed"
  | "unlock_email";

export const SAMPLES_VIEW_PATH = "/dilapidation-reports/samples";

/** Things that are not a person reading the page. Crawlers, link previewers, uptime
 *  checks, Vercel's own screenshot bot, Lighthouse, and headless browsers (which is what
 *  our own tests drive — they must not count either). Case-insensitive. */
const BOT_UA =
  /bot|crawl|spider|slurp|preview|fetch|monitor|lighthouse|pagespeed|headless|vercel|curl|wget|python|node|go-http|axios|okhttp/i;

export function looksLikeBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return BOT_UA.test(userAgent);
}

/** Records one event. Errors are logged and swallowed — analytics must never break the
 *  page, and before migration 0015 is applied the table does not exist, which is the
 *  most likely error and not one a visitor should feel. */
export async function recordPageView(
  event: PageViewEvent,
  meta: { path?: string; referrer?: string | null; userAgent?: string | null } = {}
): Promise<void> {
  try {
    await createAdminClient()
      .from("page_views")
      .insert({
        path: meta.path ?? SAMPLES_VIEW_PATH,
        event,
        referrer: meta.referrer?.slice(0, 500) ?? null,
        user_agent: meta.userAgent?.slice(0, 300) ?? null,
      });
  } catch (e) {
    console.error("[page-views] failed to record:", event, (e as Error).message);
  }
}

export type SamplesStats = {
  /** Locked + unlocked renders, i.e. "someone looked at the samples page". */
  views7d: number;
  viewsPrev7d: number;
  views30d: number;
  /** Times the full list was actually shown (cookie present). */
  libraryViews7d: number;
  unlocksCode7d: number;
  unlocksEmail7d: number;
  /** Set when the table can't be read — most likely 0015 not applied yet. */
  unavailable: string | null;
};

const DAY = 86_400_000;

export async function loadSamplesStats(): Promise<SamplesStats> {
  const out: SamplesStats = {
    views7d: 0,
    viewsPrev7d: 0,
    views30d: 0,
    libraryViews7d: 0,
    unlocksCode7d: 0,
    unlocksEmail7d: 0,
    unavailable: null,
  };
  try {
    const now = Date.now();
    const since = new Date(now - 30 * DAY).toISOString();
    const { data, error } = await createAdminClient()
      .from("page_views")
      .select("event, occurred_at")
      .eq("path", SAMPLES_VIEW_PATH)
      .gte("occurred_at", since);
    if (error) throw error;

    const week = now - 7 * DAY;
    const twoWeeks = now - 14 * DAY;
    for (const row of data ?? []) {
      const t = new Date(row.occurred_at as string).getTime();
      const ev = row.event as PageViewEvent;
      const isView = ev === "view_locked" || ev === "view_library";
      if (isView) {
        out.views30d++;
        if (t >= week) out.views7d++;
        else if (t >= twoWeeks) out.viewsPrev7d++;
      }
      if (t >= week) {
        if (ev === "view_library") out.libraryViews7d++;
        if (ev === "unlock_code") out.unlocksCode7d++;
        if (ev === "unlock_email") out.unlocksEmail7d++;
      }
    }
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    console.error("[page-views] failed to load:", message);
    out.unavailable = /page_views|schema cache|does not exist/i.test(message)
      ? "Run migration 0015_page_views.sql"
      : message;
  }
  return out;
}
