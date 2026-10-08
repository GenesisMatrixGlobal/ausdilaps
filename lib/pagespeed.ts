import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminClientConfigured } from "@/lib/supabase/env";

/**
 * Google PageSpeed Insights — the scores Google actually ranks on.
 *
 * ⚠️ NEEDS `PAGESPEED_API_KEY`. The note here used to say no key was needed at this volume;
 * by Oct 2026 Google answered every keyless request with an instant 429. Production has the
 * key; `.env.local` does not, so a local run always gets "PageSpeed 429" (and saves nothing —
 * /api/pagespeed only writes on production).
 *
 * MEASURED NIGHTLY, NEVER ON A PAGE LOAD. A Lighthouse run takes 10-40 seconds, so
 * /api/pagespeed (Vercel Cron, 2am Brisbane) runs measurePage() for every target and writes
 * the result to `pagespeed_scores` (migration 0030); /admin only calls loadPageSpeed(), a
 * two-row read. It was an unstable_cache until 2026-10-08 — the migration's header says why
 * that kept running Lighthouse in front of the GM.
 */

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/**
 * Two pages: where people land, and where they convert.
 *
 * /quote is the contact page — QUOTE_HREF in lib/site.ts, and the target of every CTA on
 * the site. It's the one page where slowness costs money directly, so it's worth watching
 * more closely than any content page.
 *
 * `path` is the table's key. Adding a target needs no migration — it reads "not measured
 * yet" until the next nightly run. Renaming a label is picked up by that run too.
 */
export const PAGESPEED_TARGETS = [
  { label: "Homepage", path: "/" },
  { label: "Quote / contact form", path: "/quote" },
] as const;

export type PageSpeedScore = {
  label: string;
  url: string;
  /** 0-100, or null when no run has ever succeeded. */
  performance: number | null;
  accessibility: number | null;
  seo: number | null;
  bestPractices: number | null;
  /** Why the LATEST check failed. The scores above can still be set — they are then the
   *  last good run, and measuredAt says how old. */
  error?: string;
  /** When the last SUCCESSFUL run happened (ISO). */
  measuredAt?: string;
  /** Whole days since measuredAt, worked out at READ time. */
  ageDays?: number;
};

export type PageSpeedReport = {
  /** In PAGESPEED_TARGETS order. EMPTY until the cron has written its first row. */
  scores: PageSpeedScore[];
  /** Why nothing could be read — the table is missing, or the read failed. Null when fine. */
  unavailable: string | null;
};

type PsiResponse = {
  lighthouseResult?: {
    categories?: Record<string, { score?: number | null } | undefined>;
  };
};

/** Lighthouse reports 0-1; humans read 0-100. */
const pct = (v: number | null | undefined): number | null =>
  typeof v === "number" ? Math.round(v * 100) : null;

/**
 * The deployed origin to measure, from NEXT_PUBLIC_SITE_URL — or why there isn't one.
 *
 * ⚠️ Never localhost, and never a guess. Lighthouse cannot reach a laptop, and a dev build
 * (no minification, no caching) would score nothing like the live site — the row would then
 * sit on the dashboard looking like a real regression. Unset means refuse, not fall back.
 */
export function measureOrigin(): { origin: string } | { reason: string } {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return { reason: "NEXT_PUBLIC_SITE_URL is not set, so there is no deployed site to measure." };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { reason: "NEXT_PUBLIC_SITE_URL is not a valid URL." };
  }
  const host = url.hostname;
  const local =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    host.endsWith(".test");
  if (url.protocol !== "https:" || local) {
    return { reason: `NEXT_PUBLIC_SITE_URL points at ${url.origin}, which is not a deployed site.` };
  }
  // The origin alone — no trailing slash, and no path even if one was configured.
  return { origin: url.origin };
}

/** One live Lighthouse run (10-40s). Never throws — a failure comes back as `error`. */
export async function measurePage(label: string, url: string): Promise<PageSpeedScore> {
  const params = new URLSearchParams({ url, strategy: "mobile" });
  // Mobile on purpose: it is what Google indexes with, and it is always the worse score.
  for (const c of ["performance", "accessibility", "seo", "best-practices"]) {
    params.append("category", c);
  }
  if (process.env.PAGESPEED_API_KEY) params.set("key", process.env.PAGESPEED_API_KEY);

  const blank: PageSpeedScore = {
    label,
    url,
    performance: null,
    accessibility: null,
    seo: null,
    bestPractices: null,
  };

  try {
    const res = await fetch(`${ENDPOINT}?${params}`, {
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[pagespeed] ${url} failed: ${res.status}`);
      return { ...blank, error: `PageSpeed ${res.status}` };
    }
    const data = (await res.json()) as PsiResponse;
    const cat = data.lighthouseResult?.categories ?? {};
    return {
      label,
      url,
      performance: pct(cat.performance?.score),
      accessibility: pct(cat.accessibility?.score),
      seo: pct(cat.seo?.score),
      bestPractices: pct(cat["best-practices"]?.score),
      measuredAt: new Date().toISOString(),
    };
  } catch (e) {
    console.warn(`[pagespeed] ${url} failed: ${(e as Error).message}`);
    return { ...blank, error: (e as Error).message };
  }
}

const DAY = 86_400_000;

type ScoreRow = {
  path: string;
  performance: number | null;
  accessibility: number | null;
  seo: number | null;
  best_practices: number | null;
  measured_at: string | null;
  error: string | null;
};

/** PostgREST's "no such table" (PGRST205), Postgres's own (42P01), and a missing column
 *  (PGRST204 / 42703, a partial paste) — all of which re-applying 0030 fixes. */
function isMissingSchema(error: { code?: string; message?: string }): boolean {
  return (
    ["PGRST205", "42P01", "PGRST204", "42703"].includes(error.code ?? "") ||
    /schema cache|does not exist/i.test(error.message ?? "")
  );
}

/**
 * The stored scores, one per target in PAGESPEED_TARGETS order. Never throws.
 *
 * ⚠️ A missing table is reported as `unavailable`, never as an empty list — "not measured
 * yet" over a table that doesn't exist would wait for an overnight run that can never land.
 */
export async function loadPageSpeed(): Promise<PageSpeedReport> {
  if (!adminClientConfigured()) {
    return { scores: [], unavailable: "Supabase isn't configured in this environment." };
  }
  try {
    const { data, error } = await createAdminClient()
      .from("pagespeed_scores")
      .select("path, performance, accessibility, seo, best_practices, measured_at, error");
    if (error) {
      console.error("[pagespeed] failed to load:", error.message);
      return {
        scores: [],
        unavailable: isMissingSchema(error)
          ? "Apply migration 0030_pagespeed_scores.sql in Supabase."
          : `Couldn't read the scores: ${error.message}`,
      };
    }

    const byPath = new Map(((data ?? []) as ScoreRow[]).map((r) => [r.path, r]));
    // A row for a page that is no longer a target is ignored, and nothing at all for the
    // current targets is "not measured yet" — not a list of blank rows.
    if (!PAGESPEED_TARGETS.some((t) => byPath.has(t.path))) return { scores: [], unavailable: null };

    const base = measureOrigin();
    const origin = "origin" in base ? base.origin : "";
    const now = Date.now();
    return {
      unavailable: null,
      scores: PAGESPEED_TARGETS.map((t): PageSpeedScore => {
        const r = byPath.get(t.path);
        const measuredAt = r?.measured_at ?? undefined;
        const at = measuredAt ? Date.parse(measuredAt) : NaN;
        return {
          // The label comes from the code, not the row, so a rename shows at once.
          label: t.label,
          url: `${origin}${t.path}`,
          performance: r?.performance ?? null,
          accessibility: r?.accessibility ?? null,
          seo: r?.seo ?? null,
          bestPractices: r?.best_practices ?? null,
          ...(r?.error ? { error: r.error } : {}),
          ...(Number.isFinite(at) ? { measuredAt, ageDays: Math.floor((now - at) / DAY) } : {}),
        };
      }),
    };
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    console.error("[pagespeed] failed to load:", message);
    return { scores: [], unavailable: `Couldn't read the scores: ${message}` };
  }
}
