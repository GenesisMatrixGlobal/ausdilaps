// Web Vitals recording and read-back (migration 0016).
//
// Mirrors lib/page-views.ts: NEVER throws, never blocks. The write side is called from an
// unauthenticated route, so everything it accepts is bounded before it reaches the database.

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type VitalsSample = {
  path: string;
  device: "mobile" | "desktop";
  lcp?: number | null;
  inp?: number | null;
  cls?: number | null;
  fcp?: number | null;
  ttfb?: number | null;
};

/** Records one page view's metrics. Errors are logged and swallowed — before migration 0016
 *  is applied the table does not exist, and a visitor must never feel that. */
export async function recordVitals(s: VitalsSample): Promise<void> {
  try {
    // ⚠️ The Supabase client RETURNS errors, it does not throw them. Awaiting the insert
    // without reading `error` swallows every failure silently — a missing table, a bad
    // column, a revoked key all look exactly like success. Check it, then throw into the
    // catch below so there is one log line and still no impact on the visitor.
    const { error } = await createAdminClient().from("web_vitals").insert({
      path: s.path,
      device: s.device,
      lcp_ms: round(s.lcp),
      inp_ms: round(s.inp),
      cls: s.cls == null ? null : Number(s.cls.toFixed(4)),
      fcp_ms: round(s.fcp),
      ttfb_ms: round(s.ttfb),
    });
    if (error) throw error;
  } catch (e) {
    console.error("[web-vitals] failed to record:", (e as Error).message);
  }
}

const round = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? null : Math.round(v);

/** Google's Core Web Vitals thresholds. A metric is judged on the 75th percentile of real
 *  visits, not the average — an average hides the slow quarter, which is the quarter that
 *  leaves. */
export const VITALS_THRESHOLDS = {
  lcp: { good: 2500, poor: 4000, unit: "ms" },
  inp: { good: 200, poor: 500, unit: "ms" },
  cls: { good: 0.1, poor: 0.25, unit: "" },
} as const;

export type VitalKey = keyof typeof VITALS_THRESHOLDS;
export type VitalRating = "good" | "needs-work" | "poor" | "none";

export function rate(key: VitalKey, p75: number | null): VitalRating {
  if (p75 == null) return "none";
  const t = VITALS_THRESHOLDS[key];
  return p75 <= t.good ? "good" : p75 <= t.poor ? "needs-work" : "poor";
}

export type WebVitals = {
  /** How many page views contributed, over the window. */
  samples: number;
  /** 75th percentile per metric, null when nothing was recorded for it. */
  p75: Record<VitalKey, number | null>;
  /** Worst pages by LCP p75, only counting paths with enough samples to mean anything. */
  slowest: { path: string; lcpP75: number; samples: number }[];
  /** Set when the table can't be read — most likely 0016 not applied yet. */
  unavailable: string | null;
};

const DAY = 86_400_000;
/** Below this a percentile is noise, not a measurement. A single slow phone on a train
 *  should not put a page at the top of a "slowest" list. */
const MIN_SAMPLES_PER_PATH = 5;

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

export async function loadWebVitals(days = 7): Promise<WebVitals> {
  const empty: WebVitals = {
    samples: 0,
    p75: { lcp: null, inp: null, cls: null },
    slowest: [],
    unavailable: null,
  };
  try {
    const since = new Date(Date.now() - days * DAY).toISOString();
    const { data, error } = await createAdminClient()
      .from("web_vitals")
      .select("path, lcp_ms, inp_ms, cls")
      .gte("occurred_at", since);
    if (error) throw error;

    const rows = data ?? [];
    const nums = (pick: (r: (typeof rows)[number]) => number | null) =>
      rows.map(pick).filter((v): v is number => v != null && Number.isFinite(v));

    const byPath = new Map<string, number[]>();
    for (const r of rows) {
      if (r.lcp_ms == null) continue;
      const list = byPath.get(r.path as string) ?? [];
      list.push(r.lcp_ms as number);
      byPath.set(r.path as string, list);
    }

    return {
      samples: rows.length,
      p75: {
        lcp: percentile(nums((r) => r.lcp_ms as number | null), 75),
        inp: percentile(nums((r) => r.inp_ms as number | null), 75),
        cls: percentile(nums((r) => (r.cls == null ? null : Number(r.cls))), 75),
      },
      slowest: [...byPath.entries()]
        .filter(([, v]) => v.length >= MIN_SAMPLES_PER_PATH)
        .map(([path, v]) => ({ path, lcpP75: percentile(v, 75) ?? 0, samples: v.length }))
        .sort((a, b) => b.lcpP75 - a.lcpP75)
        .slice(0, 4),
      unavailable: null,
    };
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    console.error("[web-vitals] failed to load:", message);
    return {
      ...empty,
      unavailable: /web_vitals|schema cache|does not exist/i.test(message)
        ? "Run migration 0016_web_vitals.sql"
        : message,
    };
  }
}
