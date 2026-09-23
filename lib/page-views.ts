// Page-view recording and read-back for the samples library (migration 0015).
//
// Mirrors lib/tools/usage.ts: NEVER throws, never blocks the caller. Callers hand
// recordPageView() to `after()` from next/server so the function stays alive until the
// insert settles — a bare fire-and-forget promise can be killed the moment the response
// is sent.

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type PageViewEvent =
  | "view_locked"
  | "view_library"
  | "unlock_code"
  | "unlock_code_failed"
  | "unlock_email"
  /** A file in the library was opened. `item` carries its title (migration 0021). */
  | "click_item";

/** What a row may carry beyond the event itself. The three 0021 fields are what let
 *  /admin/samples read the rows as people rather than a count — see that migration for
 *  what each one is and is not. */
export type PageViewMeta = {
  path?: string;
  referrer?: string | null;
  userAgent?: string | null;
  visitorId?: string | null;
  leadId?: string | null;
  item?: string | null;
};

export const SAMPLES_VIEW_PATH = "/dilapidation-reports/samples";

/**
 * Whether this runtime's analytics writes are REAL.
 *
 * ⚠️ There is no dev database on this project — `.env.local` points at production Supabase —
 * so every page load on localhost and every branch preview was writing live rows. That is
 * how `tool_usage` reached 377 rows dominated by the days we were building the markup tools,
 * and how the first web-vitals rows arrived carrying a 21-SECOND load time that was only
 * Next compiling a page in dev. Those numbers do not describe the business; they describe us.
 *
 * `VERCEL_ENV` is "production" only on a production deployment. It is undefined locally and
 * "preview" on a branch — both of which must stay out. Same gate the training indexer uses.
 */
export function isProductionRuntime(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/** Things that are not a person reading the page. Crawlers, link previewers, uptime
 *  checks, Vercel's own screenshot bot, Lighthouse, and headless browsers (which is what
 *  our own tests drive — they must not count either). Case-insensitive.
 *
 *  `ms-office` / `Mozilla/4.0`: within twenty minutes of the table existing, 53 of its 56
 *  rows were `Mozilla/4.0 (compatible; ms-office; MSOffice 16)` — Outlook's Safe Links
 *  scanner opening the samples URL out of every email that carries it. No modern browser
 *  identifies as Mozilla/4.0, so the whole prefix is treated as automation. */
const BOT_UA =
  /bot|crawl|spider|slurp|preview|fetch|monitor|lighthouse|pagespeed|headless|vercel|curl|wget|python|node|go-http|axios|okhttp|ms-office|msoffice|^Mozilla\/4\.0|electron|claude/i;

export function looksLikeBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return BOT_UA.test(userAgent);
}

/** Records one event. Errors are logged and swallowed — analytics must never break the
 *  page, and before migration 0015 is applied the table does not exist, which is the
 *  most likely error and not one a visitor should feel. */
export async function recordPageView(event: PageViewEvent, meta: PageViewMeta = {}): Promise<void> {
  if (!isProductionRuntime()) return;
  try {
    const db = createAdminClient();
    const base = {
      path: meta.path ?? SAMPLES_VIEW_PATH,
      event,
      referrer: meta.referrer?.slice(0, 500) ?? null,
      user_agent: meta.userAgent?.slice(0, 300) ?? null,
    };
    // Only sent when set, so a row before 0021 and a row after it differ only where they
    // should.
    const extra: Record<string, string> = {};
    if (meta.visitorId) extra.visitor_id = meta.visitorId;
    if (meta.leadId) extra.lead_id = meta.leadId;
    if (meta.item) extra.item = meta.item.slice(0, 200);

    // ⚠️ Supabase RETURNS errors rather than throwing, so an unchecked insert swallows
    // every failure silently. This one hid a missing table for the whole gap between
    // deploying the gate and applying migration 0015.
    let { error } = await db.from("page_views").insert({ ...base, ...extra });

    // The 0021 columns are pasted in by hand, so a deploy can land before them. A failed
    // insert here would stop EVERY samples view being counted for that window — fall back
    // to the 0015 shape and say so.
    if (error && Object.keys(extra).length > 0 && /visitor_id|lead_id|'item'/.test(error.message)) {
      console.warn("[page-views] 0021 columns missing — apply migration 0021_samples_visitors.sql.");
      ({ error } = await db.from("page_views").insert(base));
    }
    if (error) throw error;
  } catch (e) {
    console.error("[page-views] failed to record:", event, (e as Error).message);
  }
}

/** How far back a paint may confirm a view. Long enough for a slow page on a bad connection,
 *  short enough that a tab reopened tomorrow confirms tomorrow's view and not yesterday's. */
const RENDER_CONFIRM_WINDOW_MS = 30 * 60_000;

/**
 * Marks this visitor's most recent samples view as actually PAINTED (migration 0023).
 *
 * Two round trips rather than one: PostgREST cannot order-and-limit an UPDATE, so the row is
 * found first and updated by id. Both are inside `after()`, so nothing waits on them.
 *
 * Only ever touches a view row. A click or an unlock is already proof of a human and has no
 * business being rewritten by a beacon.
 */
export async function markRendered(visitorId: string): Promise<void> {
  if (!isProductionRuntime()) return;
  try {
    const db = createAdminClient();
    const since = new Date(Date.now() - RENDER_CONFIRM_WINDOW_MS).toISOString();
    const { data, error } = await db
      .from("page_views")
      .select("id")
      .eq("visitor_id", visitorId)
      .in("event", ["view_locked", "view_library"])
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    const id = data?.[0]?.id as string | undefined;
    if (!id) return;

    const { error: upErr } = await db.from("page_views").update({ rendered: true }).eq("id", id);
    if (upErr) {
      // 0023 is pasted in by hand, so a deploy can land before it. Say which migration, once,
      // rather than logging an opaque column error on every page load.
      if (/rendered/.test(upErr.message)) {
        console.warn("[page-views] no `rendered` column — apply migration 0023_page_view_rendered.sql.");
        return;
      }
      throw upErr;
    }
  } catch (e) {
    console.error("[page-views] failed to mark rendered:", (e as Error).message);
  }
}

export type SamplesStats = {
  /** Views the browser CONFIRMED it painted — i.e. a person actually looked at the page.
   *  Everything on this type counts only these. */
  views7d: number;
  viewsPrev7d: number;
  views30d: number;
  /** Times the full list was actually shown (cookie present). */
  libraryViews7d: number;
  unlocksCode7d: number;
  unlocksEmail7d: number;
  /** Requests that were served but never painted, over the same 7 days. Headless scrapers
   *  announcing themselves as desktop Chrome — kept and reported rather than hidden, because
   *  it is the only measure of how much of that there is. */
  unrendered7d: number;
  /** Views too old to have been measured (before migration 0023 / its first paint). Reported
   *  apart from `unrendered7d` so nothing historic is miscalled automated. */
  unmeasured7d: number;
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
    unrendered7d: 0,
    unmeasured7d: 0,
    unavailable: null,
  };
  try {
    const now = Date.now();
    const since = new Date(now - 30 * DAY).toISOString();
    const { data, error } = await createAdminClient()
      .from("page_views")
      .select("event, occurred_at, rendered")
      .eq("path", SAMPLES_VIEW_PATH)
      .gte("occurred_at", since);
    if (error) throw error;

    const week = now - 7 * DAY;
    const twoWeeks = now - 14 * DAY;
    const rows = data ?? [];

    // Anything before the first confirmed paint could not have been measured — 0023 had not
    // landed, or the beacon had not shipped. Calling those rows automated would put a number
    // on the dashboard that is simply an artefact of when the column was added.
    const firstMeasured = rows
      .filter((r) => r.rendered === true)
      .reduce<number | null>((min, r) => {
        const t = new Date(r.occurred_at as string).getTime();
        return min === null || t < min ? t : min;
      }, null);

    for (const row of rows) {
      const t = new Date(row.occurred_at as string).getTime();
      const ev = row.event as PageViewEvent;
      const isView = ev === "view_locked" || ev === "view_library";
      const painted = row.rendered === true;

      if (isView) {
        // ⚠️ Only a painted view is a view. The count read 26 "visitors" when about twenty
        // were headless fetches — see migration 0023 for the measurement that settled it.
        if (painted) {
          out.views30d++;
          if (t >= week) out.views7d++;
          else if (t >= twoWeeks) out.viewsPrev7d++;
        } else if (t >= week) {
          if (firstMeasured !== null && t >= firstMeasured) out.unrendered7d++;
          else out.unmeasured7d++;
        }
      }
      if (t >= week) {
        // An unlock or a library view is only counted when it painted, for the same reason.
        if (ev === "view_library" && painted) out.libraryViews7d++;
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
