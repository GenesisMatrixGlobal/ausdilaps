import "server-only";

/**
 * Google PageSpeed Insights — the scores Google actually ranks on.
 *
 * No API key needed at this volume (the free tier allows a small number of unauthenticated
 * requests per minute, and we make two a day). Set PAGESPEED_API_KEY if that ever changes.
 *
 * A PSI run takes 10-30 seconds, so this must never sit in the request path. Callers wrap
 * it in unstable_cache with a 24h revalidate — see lib/admin/dashboard.ts. It returns a
 * null-scored result rather than throwing, so a bad day at Google is a blank tile, not a
 * broken dashboard.
 */

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/** Two pages: the homepage, and the page the whole SEO strategy is built around. */
export const PAGESPEED_TARGETS = [
  { label: "Homepage", path: "/" },
  { label: "Dilapidation reports", path: "/dilapidation-reports" },
] as const;

export type PageSpeedScore = {
  label: string;
  url: string;
  /** 0-100, or null when the run failed or has not happened yet. */
  performance: number | null;
  accessibility: number | null;
  seo: number | null;
  bestPractices: number | null;
  error?: string;
};

type PsiResponse = {
  lighthouseResult?: {
    categories?: Record<string, { score?: number | null } | undefined>;
  };
};

/** Lighthouse reports 0-1; humans read 0-100. */
const pct = (v: number | null | undefined): number | null =>
  typeof v === "number" ? Math.round(v * 100) : null;

async function runOne(label: string, url: string): Promise<PageSpeedScore> {
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
    };
  } catch (e) {
    return { ...blank, error: (e as Error).message };
  }
}

/**
 * Scores for every target. Runs them in parallel — two requests, and PSI rate-limits on
 * requests per minute rather than concurrency.
 */
export async function loadPageSpeed(origin: string): Promise<PageSpeedScore[]> {
  return Promise.all(
    PAGESPEED_TARGETS.map((t) => runOne(t.label, `${origin.replace(/\/$/, "")}${t.path}`))
  );
}
