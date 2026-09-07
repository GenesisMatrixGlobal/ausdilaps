import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_LIST_ROWS, STALLED_RUN_MS, WINDOW_DAYS } from "./config";
import { displayTitle, groupItems, type ItemGroup } from "./group";
import { SOURCES } from "./sources";
import { mailboxConfigured } from "./sources/mailbox";

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
    windowDays: WINDOW_DAYS,
    truncated: false,
    unavailable,
    stats: { scans: 0, scanned: 0, open: 0, lastScanAt: null as string | null, lastScanStatus: null as string | null },
    queues: { pending: 0, stalled: 0 },
    funnel: { fetched: 0, fresh: 0, duplicate: 0, prefiltered: 0, classified: 0, matched: 0, review: 0, sent: 0 },
    sources: [] as SourceView[],
    items: [] as ItemView[],
    groups: [] as GroupView[],
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
  /** Created by discovery from a sender domain, rather than listed in code. */
  autoDiscovered: boolean;
  /** Opt-in to the gone-quiet alarm. Off by default — see the note on `health` above. */
  alertOnQuiet: boolean;
  isTrusted: boolean;
  parseMode: string;
  senderDomain: string | null;
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
  /** tender_item_status. 'archived' is what Dismiss sets. */
  status: string;
  reviewedAt: string | null;
  createdAt: string;
};

/**
 * One opportunity: a group of rows that are the same job.
 *
 * See lib/tenders/group.ts for why the same tender arrives up to five times and why the
 * collapsing happens here rather than at ingest.
 */
export type GroupView = {
  key: string;
  /** Which list this belongs in. See groupState() for why 'sent' beats 'queue'. */
  state: "queue" | "sent" | "dismissed";
  count: number;
  /** Already through displayTitle() — never render lead.title directly. */
  title: string;
  lead: ItemView;
  members: ItemView[];
  /** Every place it arrived from, deduped, most confident first. */
  sources: { label: string; url: string | null }[];
};

type RunView = {
  source_slug: string;
  status: string;
  started_at: string;
  triggered_by: string;
  items_fetched: number;
  items_new: number;
  items_duplicate: number;
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
  const since = new Date(now - WINDOW_DAYS * DAY).toISOString();

  const [runRows, sourceRows, itemRows, pendingCount] = await Promise.all([
    db
      .from("tender_scan_runs")
      .select(
        "source_slug, status, started_at, items_fetched, items_new, items_duplicate, error, duration_ms, triggered_by"
      )
      .gte("started_at", since)
      .order("started_at", { ascending: false }),
    db.from("tender_sources").select("*").order("slug"),
    // Scoped by the window, not by a bare row cap. The old `.limit(120)` with no time
    // filter is half of the "16 matches" bug: eight matches simply fell off the end of the
    // list, so the tab count and every count derived from it were quietly short.
    db
      .from("tender_items")
      .select(
        "id, title, agency, jurisdiction, url, closes_at, source_slug, relevance, confidence, services, model_summary, model_reasoning, classified_by, classified_at, model, status, reviewed_at, sender_trusted, injection_suspected, forwarded_at, created_at"
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(MAX_LIST_ROWS),
    // Queue depth, deliberately NOT windowed: an item stuck pending since last month is
    // exactly what this is for, and hiding it behind the report window would defeat it.
    db.from("tender_items").select("id", { count: "exact", head: true }).eq("relevance", "pending"),
  ]);

  const recent = runRows.data ?? [];
  const items = itemRows.data ?? [];
  // If this ever trips, the window is producing more rows than the cap and the numbers
  // below are short again. Surfaced rather than silently wrong.
  const truncated = items.length >= MAX_LIST_ROWS;

  // Counted by distinct night, not by row — a run fans out to one row per source, and
  // "30 scans in 30 days" is what a human means by it.
  const scanDays = new Set(recent.map((r) => (r.started_at as string).slice(0, 10)));
  const lastRun = recent.reduce<{ at: string; status: string } | null>((latest, r) => {
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
    const isEmail = (s.kind as string) === "email";
    const alertOnQuiet = (s.alert_on_quiet as boolean) ?? false;
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
      //
      // Email sources are discovered, so they are not in the code registry at all. Falling
      // through to `false` would have rendered every one of them permanently "not
      // configured" — present, greyed out, and apparently doing nothing.
      configured: isEmail ? mailboxConfigured() : definition ? definition.configured() : false,
      lastSuccessAt: (s.last_success_at as string | null) ?? null,
      lastItemAt: (s.last_item_at as string | null) ?? null,
      consecutiveEmpty: empty,
      consecutiveFailures: failures,
      itemsLastRun: (latestBySource.get(slug)?.items_fetched as number) ?? 0,
      dailyAverage: Math.round(avg * 10) / 10,
      autoDiscovered: (s.auto_discovered as boolean) ?? false,
      alertOnQuiet,
      isTrusted: (s.is_trusted as boolean) ?? false,
      parseMode: (s.parse_mode as string) ?? "auto",
      senderDomain: (s.sender_domain as string | null) ?? null,
      // A source only goes quiet/critical if someone asked to be told. Every direct client
      // invitation is also a source now, and a client who emailed once in March is not a
      // fault — without this the dashboard would be mostly red inside a month and the
      // alarm that exists to catch buy.nsw dropping us would be the thing nobody reads.
      //
      // Failures are NOT opt-in: a source that errored is broken whoever owns it.
      health: (failures > 0
        ? "failing"
        : alertOnQuiet && empty >= 5
          ? "critical"
          : alertOnQuiet && empty >= 3
            ? "quiet"
            : "healthy") as "healthy" | "quiet" | "critical" | "failing",
      lastError: isAdmin ? ((s.last_error as string | null) ?? null) : null,
    };
  });

  /**
   * The funnel.
   *
   * ⚠️ The fetch half comes from run counters; the classify half is counted from the ITEM
   * ROWS. That asymmetry is deliberate and is the fix for "329 scanned, 0 matches".
   *
   * tender_scan_runs has columns for items_classified, items_matched, items_forwarded,
   * items_prefiltered and items_errored — and no code has ever written any of them. They
   * could not be written honestly: a run row is per-source and is closed at the end of
   * Phase A, while classification is a single pass across the whole queue afterwards, so
   * there is no source to attribute a match to. The old funnel summed those five columns
   * and therefore reported 0 forever, directly above a list of real matches.
   *
   * Counting the item rows removes the class of bug rather than the instance: `items` is
   * the exact array the list below renders, so a tile and the list it sits above cannot
   * disagree. Only fetched/fresh/duplicate stay on the run counters, because those are
   * genuinely facts about a fetch and nothing else records them.
   */
  const fetchCounters = recent.reduce(
    (acc, r) => ({
      fetched: acc.fetched + ((r.items_fetched as number) ?? 0),
      fresh: acc.fresh + ((r.items_new as number) ?? 0),
      duplicate: acc.duplicate + ((r.items_duplicate as number) ?? 0),
    }),
    { fetched: 0, fresh: 0, duplicate: 0 }
  );

  const countItems = (fn: (i: (typeof items)[number]) => boolean) => items.filter(fn).length;

  const funnel = {
    ...fetchCounters,
    prefiltered: countItems((i) => i.classified_by === "prefilter"),
    classified: countItems((i) => i.classified_by === "anthropic"),
    matched: countItems((i) => i.relevance === "match"),
    review: countItems((i) => i.relevance === "maybe"),
    sent: countItems((i) => i.forwarded_at !== null),
  };

  const itemViews: ItemView[] = items.map((i) => ({
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
    status: (i.status as string) ?? "new",
    reviewedAt: (i.reviewed_at as string | null) ?? null,
    createdAt: i.created_at as string,
  }));

  // Only match/maybe are grouped — a no_match row is never an opportunity, and grouping the
  // 130 prefiltered rejects would cost work nobody looks at.
  const groups = groupItems(itemViews.filter((i) => i.relevance === "match" || i.relevance === "maybe")).map(
    toGroupView
  );

  return {
    // Captured server-side so every relative timestamp in the UI is measured from one
    // instant, and the client never calls Date.now() during render.
    now,
    isAdmin,
    windowDays: WINDOW_DAYS,
    truncated,
    unavailable: null as string | null,
    stats: {
      scans: scanDays.size,
      scanned: fetchCounters.fetched,
      // The headline number is what is waiting for a person, not a lifetime total. It reads
      // off `groups`, so it is the count of the cards immediately below it.
      open: groups.filter((g) => g.state === "queue").length,
      lastScanAt: lastRun?.at ?? null,
      lastScanStatus: lastRun?.status ?? null,
    },
    queues: {
      pending: pendingCount.count ?? 0,
      stalled,
    },
    funnel,
    sources,
    items: itemViews,
    groups,
    // The run log is operator detail — it carries error text and timings.
    runs: isAdmin
      ? recent.slice(0, 30).map((r) => ({
          source_slug: r.source_slug as string,
          status: r.status as string,
          started_at: r.started_at as string,
          triggered_by: r.triggered_by as string,
          items_fetched: (r.items_fetched as number) ?? 0,
          items_new: (r.items_new as number) ?? 0,
          items_duplicate: (r.items_duplicate as number) ?? 0,
          duration_ms: (r.duration_ms as number | null) ?? null,
          error: (r.error as string | null) ?? null,
        }))
      : [],
  };
}

/**
 * Which list a group belongs in.
 *
 * `sent` deliberately beats `queue`: portals send reminders for the same job for weeks, so
 * once any copy has been handed over, a fresh copy arriving must NOT push it back into the
 * queue. That would recreate exactly the nagging this feature exists to stop.
 *
 * `dismissed` requires EVERY member archived. Dismissing one copy of a five-copy job is a
 * judgement about that email, not about the opportunity.
 */
function groupState(members: ItemView[]): GroupView["state"] {
  if (members.every((m) => m.status === "archived")) return "dismissed";
  if (members.some((m) => m.forwardedAt !== null)) return "sent";
  return "queue";
}

function toGroupView(g: ItemGroup<ItemView>): GroupView {
  // Deduped by source, keeping the most confident copy's link for each — a reader following
  // one of these wants the notice, not whichever reminder happened to arrive last.
  const bySource = new Map<string, { label: string; url: string | null }>();
  for (const m of [...g.members].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))) {
    if (!bySource.has(m.source)) bySource.set(m.source, { label: m.source, url: m.url });
  }

  return {
    key: g.key,
    state: groupState(g.members),
    count: g.count,
    title: displayTitle({ title: g.lead.title, agency: g.lead.agency, summary: g.lead.summary }),
    lead: g.lead,
    members: g.members,
    sources: [...bySource.values()],
  };
}
