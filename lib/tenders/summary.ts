import { createAdminClient } from "@/lib/supabase/admin";
import { STALLED_RUN_MS, forwardingEnabled } from "./config";
import { SOURCES } from "./sources";

/**
 * Everything the Tender Watch UI renders, in one query set.
 *
 * Shared by the server component (initial render — no round trip, no effect) and the
 * /api/tenders/summary route (refresh after a manual scan). Callers do the authorisation;
 * this only takes `isAdmin` to decide what to withhold.
 *
 * Reads use the service-role client because the runs and sources tables are is_internal()
 * at the RLS layer while ordinary accounts staff need source health. Operator-only detail
 * — upstream error text, the run log — is filtered here rather than in the browser.
 */

const DAY = 86_400_000;

export type TenderSummary = Awaited<ReturnType<typeof loadTenderSummary>>;

/**
 * Feature-detected the same way app/api/quote/route.ts checks before its insert, so an
 * unconfigured environment renders an explanatory panel instead of a 500. createAdminClient()
 * throws on missing env vars, and a staff tool that white-screens is a worse failure than
 * one that says what is missing.
 */
function supabaseConfigured(): boolean {
  return !!(
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY) &&
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)
  );
}

function emptySummary(isAdmin: boolean, unavailable: string | null) {
  return {
    now: Date.now(),
    isAdmin,
    shadowMode: !forwardingEnabled(),
    unavailable,
    stats: { scans: 0, scanned: 0, matched: 0, lastScanAt: null as string | null, lastScanStatus: null as string | null },
    queues: { pending: 0, unforwarded: 0, stalled: 0 },
    funnel: { fetched: 0, fresh: 0, duplicate: 0, classified: 0, matched: 0, forwarded: 0, prefiltered: 0 },
    sources: [] as SourceView[],
    items: [] as ItemView[],
    runs: [] as RunView[],
  };
}

type SourceView = {
  slug: string;
  label: string;
  kind: string;
  isEnabled: boolean;
  configured: boolean;
  lastSuccessAt: string | null;
  lastItemAt: string | null;
  consecutiveEmpty: number;
  consecutiveFailures: number;
  itemsLastRun: number;
  dailyAverage: number;
  health: "healthy" | "quiet" | "critical" | "failing";
  lastError: string | null;
};

type ItemView = {
  id: string;
  title: string;
  agency: string | null;
  jurisdiction: string | null;
  url: string | null;
  closesAt: string | null;
  source: string;
  relevance: "pending" | "match" | "maybe" | "no_match" | "error";
  confidence: number | null;
  services: string[];
  summary: string | null;
  reasoning: string | null;
  classifiedBy: string | null;
  classifiedAt: string | null;
  model: string | null;
  senderTrusted: boolean;
  injectionSuspected: boolean;
  forwardedAt: string | null;
  createdAt: string;
};

type RunView = {
  source_slug: string;
  status: string;
  started_at: string;
  triggered_by: string;
  items_fetched: number;
  items_new: number;
  items_matched: number;
  duration_ms: number | null;
  error: string | null;
};

export async function loadTenderSummary(isAdmin: boolean) {
  if (!supabaseConfigured()) {
    return emptySummary(isAdmin, "Supabase isn't configured in this environment.");
  }

  try {
    return await query(isAdmin);
  } catch (e) {
    const message = (e as Error).message;
    console.error("[tenders] summary query failed:", message);
    // The most likely cause in practice is migration 0006 not having been run yet.
    return emptySummary(isAdmin, `Tender tables unavailable: ${message}`);
  }
}

async function query(isAdmin: boolean) {
  const db = createAdminClient();
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY).toISOString();
  const since14 = new Date(now - 14 * DAY).toISOString();

  const [runs30, runs14, sourceRows, itemRows, pendingCount, unforwardedCount] = await Promise.all([
    db.from("tender_scan_runs").select("status, started_at, items_fetched, items_matched").gte("started_at", since30),
    db
      .from("tender_scan_runs")
      .select(
        "source_slug, status, started_at, items_fetched, items_new, items_duplicate, items_classified, items_matched, items_forwarded, error, duration_ms, triggered_by"
      )
      .gte("started_at", since14)
      .order("started_at", { ascending: false }),
    db.from("tender_sources").select("*").order("slug"),
    db
      .from("tender_items")
      .select(
        "id, title, agency, jurisdiction, url, closes_at, source_slug, relevance, confidence, services, model_summary, model_reasoning, classified_by, classified_at, model, status, sender_trusted, injection_suspected, forwarded_at, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(120),
    db.from("tender_items").select("id", { count: "exact", head: true }).eq("relevance", "pending"),
    db
      .from("tender_items")
      .select("id", { count: "exact", head: true })
      .in("relevance", ["match", "maybe"])
      .is("forwarded_at", null),
  ]);

  const runs = runs30.data ?? [];
  const recent = runs14.data ?? [];
  const items = itemRows.data ?? [];

  // Counted by distinct night, not by row — a run fans out to one row per source, and
  // "30 scans in 30 days" is what a human means by it.
  const scanDays = new Set(runs.map((r) => (r.started_at as string).slice(0, 10)));
  const lastRun = runs.reduce<{ at: string; status: string } | null>((latest, r) => {
    const at = r.started_at as string;
    return !latest || at > latest.at ? { at, status: r.status as string } : latest;
  }, null);

  const stalledCutoff = new Date(now - STALLED_RUN_MS).toISOString();
  const stalled = recent.filter((r) => r.status === "running" && (r.started_at as string) < stalledCutoff).length;

  const latestBySource = new Map<string, (typeof recent)[number]>();
  for (const r of recent) {
    if (!latestBySource.has(r.source_slug as string)) latestBySource.set(r.source_slug as string, r);
  }

  const sources = (sourceRows.data ?? []).map((s) => {
    const slug = s.slug as string;
    const empty = (s.consecutive_empty as number) ?? 0;
    const failures = (s.consecutive_failures as number) ?? 0;
    const definition = SOURCES.find((d) => d.slug === slug);
    const sourceRuns = recent.filter((r) => r.source_slug === slug);
    const avg = sourceRuns.length
      ? sourceRuns.reduce((n, r) => n + ((r.items_fetched as number) ?? 0), 0) / sourceRuns.length
      : 0;

    return {
      slug,
      label: s.label as string,
      kind: s.kind as string,
      isEnabled: s.is_enabled as boolean,
      // An unconfigured source reads as "off", not "broken" — an important distinction on
      // a dashboard whose whole job is making real failure obvious.
      configured: definition ? definition.configured() : false,
      lastSuccessAt: (s.last_success_at as string | null) ?? null,
      lastItemAt: (s.last_item_at as string | null) ?? null,
      consecutiveEmpty: empty,
      consecutiveFailures: failures,
      itemsLastRun: (latestBySource.get(slug)?.items_fetched as number) ?? 0,
      dailyAverage: Math.round(avg * 10) / 10,
      health: (failures > 0 ? "failing" : empty >= 5 ? "critical" : empty >= 3 ? "quiet" : "healthy") as
        | "healthy"
        | "quiet"
        | "critical"
        | "failing",
      lastError: isAdmin ? ((s.last_error as string | null) ?? null) : null,
    };
  });

  const funnel = recent.reduce(
    (acc, r) => ({
      fetched: acc.fetched + ((r.items_fetched as number) ?? 0),
      fresh: acc.fresh + ((r.items_new as number) ?? 0),
      duplicate: acc.duplicate + ((r.items_duplicate as number) ?? 0),
      classified: acc.classified + ((r.items_classified as number) ?? 0),
      matched: acc.matched + ((r.items_matched as number) ?? 0),
      forwarded: acc.forwarded + ((r.items_forwarded as number) ?? 0),
    }),
    { fetched: 0, fresh: 0, duplicate: 0, classified: 0, matched: 0, forwarded: 0 }
  );

  const prefiltered = items.filter(
    (i) => i.classified_by === "prefilter" && (i.created_at as string) >= since14
  ).length;

  return {
    // Captured server-side so every relative timestamp in the UI is measured from one
    // instant, and the client never calls Date.now() during render.
    now,
    isAdmin,
    shadowMode: !forwardingEnabled(),
    unavailable: null as string | null,
    stats: {
      scans: scanDays.size,
      scanned: runs.reduce((n, r) => n + ((r.items_fetched as number) ?? 0), 0),
      matched: runs.reduce((n, r) => n + ((r.items_matched as number) ?? 0), 0),
      lastScanAt: lastRun?.at ?? null,
      lastScanStatus: lastRun?.status ?? null,
    },
    queues: {
      pending: pendingCount.count ?? 0,
      unforwarded: unforwardedCount.count ?? 0,
      stalled,
    },
    funnel: { ...funnel, prefiltered },
    sources,
    items: items.map((i) => ({
      id: i.id as string,
      title: i.title as string,
      agency: (i.agency as string | null) ?? null,
      jurisdiction: (i.jurisdiction as string | null) ?? null,
      url: (i.url as string | null) ?? null,
      closesAt: (i.closes_at as string | null) ?? null,
      source: i.source_slug as string,
      relevance: i.relevance as "pending" | "match" | "maybe" | "no_match" | "error",
      confidence: (i.confidence as number | null) ?? null,
      services: (i.services as string[]) ?? [],
      summary: (i.model_summary as string | null) ?? null,
      reasoning: (i.model_reasoning as string | null) ?? null,
      classifiedBy: (i.classified_by as string | null) ?? null,
      classifiedAt: (i.classified_at as string | null) ?? null,
      model: (i.model as string | null) ?? null,
      senderTrusted: (i.sender_trusted as boolean) ?? false,
      injectionSuspected: (i.injection_suspected as boolean) ?? false,
      forwardedAt: (i.forwarded_at as string | null) ?? null,
      createdAt: i.created_at as string,
    })),
    // The run log is operator detail — it carries error text and timings.
    runs: isAdmin
      ? recent.slice(0, 30).map((r) => ({
          source_slug: r.source_slug as string,
          status: r.status as string,
          started_at: r.started_at as string,
          triggered_by: r.triggered_by as string,
          items_fetched: (r.items_fetched as number) ?? 0,
          items_new: (r.items_new as number) ?? 0,
          items_matched: (r.items_matched as number) ?? 0,
          duration_ms: (r.duration_ms as number | null) ?? null,
          error: (r.error as string | null) ?? null,
        }))
      : [],
  };
}
