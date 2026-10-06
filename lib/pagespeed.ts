import "server-only";
import { unstable_cache } from "next/cache";

/**
 * Google PageSpeed Insights — the scores Google actually ranks on.
 *
 * ⚠️ NEEDS `PAGESPEED_API_KEY`. The note here used to say no key was needed at this volume;
 * by Oct 2026 Google answered every keyless request with an instant 429. Production has the
 * key; `.env.local` does not, so localhost always shows "PageSpeed 429".
 *
 * A PSI run takes 10-30 seconds, so it is cached for 24h per page — see cachedScore().
 * loadPageSpeed() never throws: a bad day at Google is a blank row, not a broken dashboard.
 */

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/**
 * Two pages: where people land, and where they convert.
 *
 * /quote is the contact page — QUOTE_HREF in lib/site.ts, and the target of every CTA on
 * the site. It's the one page where slowness costs money directly, so it's worth watching
 * more closely than any content page.
 */
export const PAGESPEED_TARGETS = [
  { label: "Homepage", path: "/" },
  { label: "Quote / contact form", path: "/quote" },
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
  /** When Google ran it (ISO) — set on success only. */
  measuredAt?: string;
  /** Whole days since measuredAt, worked out at READ time (the cached score can't know). */
  ageDays?: number;
};

type PsiResponse = {
  lighthouseResult?: {
    categories?: Record<string, { score?: number | null } | undefined>;
  };
};

/** Lighthouse reports 0-1; humans read 0-100. */
const pct = (v: number | null | undefined): number | null =>
  typeof v === "number" ? Math.round(v * 100) : null;

async function measurePage(label: string, url: string): Promise<PageSpeedScore> {
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

/**
 * ONE cache entry PER PAGE, and a failed run THROWS out of it instead of being returned.
 *
 * unstable_cache stores whatever its callback returns, so a returned "PageSpeed 429" used to
 * sit on the dashboard for the full 24 hours. A throw stores nothing (read in Next 16's
 * unstable-cache.js): with an older good score cached, Next keeps serving it and retries on
 * the next load; with none, the error shows uncached and the next load retries. Per page,
 * so one page failing can't throw away the other's fresh score.
 *
 * Label and path are ARGUMENTS, so they are in each entry's key — editing PAGESPEED_TARGETS
 * can't serve old scores under new labels. "v2" retires the old whole-list entries, which
 * may be holding a cached failure.
 */
const cachedScore = unstable_cache(
  async (origin: string, label: string, path: string) => {
    const score = await measurePage(label, `${origin}${path}`);
    if (score.error) throw new Error(score.error);
    return score;
  },
  ["pagespeed-v2"],
  { revalidate: 86_400, tags: ["pagespeed"] }
);

const DAY = 86_400_000;

/**
 * Scores for every target, cached (above). Runs them in parallel — two requests, and PSI
 * rate-limits on requests per minute rather than concurrency. Never throws.
 */
export async function loadPageSpeed(origin: string): Promise<PageSpeedScore[]> {
  const base = origin.replace(/\/$/, "");
  const now = Date.now();
  return Promise.all(
    PAGESPEED_TARGETS.map(async (t): Promise<PageSpeedScore> => {
      try {
        const score = await cachedScore(base, t.label, t.path);
        const at = score.measuredAt ? Date.parse(score.measuredAt) : NaN;
        return Number.isFinite(at) ? { ...score, ageDays: Math.floor((now - at) / DAY) } : score;
      } catch (e) {
        return {
          label: t.label,
          url: `${base}${t.path}`,
          performance: null,
          accessibility: null,
          seo: null,
          bestPractices: null,
          error: (e as Error).message,
        };
      }
    })
  );
}
