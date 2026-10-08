import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClientConfigured } from "@/lib/supabase/env";
import { MAX_LIST_ROWS, STALLED_RUN_MS, WINDOW_DAYS } from "./config";
import { MIN_LEAD_TIME_MS, isActionable } from "./actionable";
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

/**
 * How many rejected rows the Rejected tab lists — the NEWEST ones in the window.
 *
 * ⚠️ The tab's COUNT is not this list's length; it is a count query (`rejectedTotal`). The
 * window holds ~1,000 no_match rows, nearly all prefilter rejects, and shipping every one of
 * them on every visit was ~0.8MB of a page whose job is the dozen matches. The tab exists to
 * audit the classifier, which reading the latest hundred does as well as reading all of them —
 * so the rows keep their reasoning and only the tail is cut, and the screen says it was.
 */
export const REJECTED_LIST_ROWS = 100;

/** Every column ItemView is built from. One list, so the three item queries cannot drift. */
const ITEM_COLUMNS =
  "id, title, agency, site_location, contact, jurisdiction, url, closes_at, source_slug, relevance, confidence, services, model_summary, model_reasoning, classified_by, classified_at, model, status, reviewed_at, sender_trusted, injection_suspected, forwarded_at, created_at, email_from";

/**
 * Unwraps a tender_items read, THROWING on a query error.
 *
 * ⚠️ The Supabase client RETURNS errors rather than throwing them, so `count ?? 0` and
 * `data ?? []` read a failed query as "nothing there" — a funnel of zeros, presented as fact.
 * Thrown, it reaches loadTenderSummary's catch and the page says the tables are unavailable,
 * which is the failure this file already chose: an undercount presented as a total is worse
 * than no figure.
 */
function must<T extends { error: { message: string } | null; status?: number }>(result: T): T {
  // A failed HEAD (the count queries) has no body, so postgrest-js hands back an EMPTY
  // message — fall back to the status or the panel reads "unavailable: " with no reason.
  if (result.error) throw new Error(result.error.message || `tender_items query failed (HTTP ${result.status ?? "?"})`);
  return result;
}

export type TenderSummary = Awaited<ReturnType<typeof loadTenderSummary>>;

function emptySummary(isAdmin: boolean, unavailable: string | null) {
  return {
    now: Date.now(),
    isAdmin,
    windowDays: WINDOW_DAYS,
    truncated: false,
    unavailable,
    stats: {
      scans: 0,
      scanned: 0,
      open: 0,
      lastScanAt: null as string | null,
      lastScanStatus: null as string | null,
      closedUnreviewed: 0,
    },
    queues: { pending: 0, stalled: 0 },
    funnel: { fetched: 0, fresh: 0, duplicate: 0, prefiltered: 0, classified: 0, matched: 0, review: 0, sent: 0 },
    sources: [] as SourceView[],
    items: [] as ItemView[],
    rejected: [] as ItemView[],
    rejectedTotal: 0,
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
  siteLocation: string | null;
  contact: string | null;
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
  /** Who emailed us. The submission contact for a direct invitation — see emailFromOf(). */
  emailFrom: string | null;
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
  /**
   * Best value across the whole group, not just the lead.
   *
   * A reminder often omits the location the original notice carried, and the copy that leads
   * (highest confidence) is not necessarily the most complete one. The send route resolves
   * these the same way — the screen and the email must not disagree about an address.
   */
  siteLocation: string | null;
  contact: string | null;
  /** Who emailed us, raw. senderOrigin() decides whether that is a contact or provenance. */
  emailFrom: string | null;
  /** `TW-4F7K2`, once this opportunity has been sent. Null before that. */
  handoffCode: string | null;
  /** Every exact group key folded in — see ItemGroup.mergedKeys. Used for code lookup. */
  mergedKeys: string[];
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

/**
 * `db` is for the check scripts, which pass their own client (scripts/_db.ts). The app passes
 * nothing and gets the service-role client — imported DYNAMICALLY, because
 * lib/supabase/admin.ts opens with `import "server-only"`, which does not resolve under tsx;
 * a static import here crashed check:summary and check:sources before they did anything.
 *
 * Feature-detected the same way app/api/quote/route.ts checks before its insert, so an
 * unconfigured environment renders an explanatory panel instead of a 500. createAdminClient()
 * throws on missing env vars, and a staff tool that white-screens is a worse failure than
 * one that says what is missing.
 */
export async function loadTenderSummary(isAdmin: boolean, db?: SupabaseClient) {
  if (!adminClientConfigured()) {
    return emptySummary(isAdmin, "Supabase isn't configured in this environment.");
  }

  try {
    return await query(isAdmin, db ?? (await import("@/lib/supabase/admin")).createAdminClient());
  } catch (e) {
    const message = (e as Error).message;
    console.error("[tenders] summary query failed:", message);
    // The most likely cause in practice is migration 0006 not having been run yet.
    return emptySummary(isAdmin, `Tender tables unavailable: ${message}`);
  }
}

async function query(isAdmin: boolean, db: SupabaseClient) {
  const now = Date.now();
  const since = new Date(now - WINDOW_DAYS * DAY).toISOString();

  /**
   * A windowed row COUNT — no rows travel. Every funnel figure past the fetch is one.
   * The explicit return type keeps the builder's `any` inside this helper: without it every
   * funnel figure and rejectedTotal in the exported TenderSummary type widened to `any`.
   */
  const windowCount = (
    filter: (b: any) => any // eslint-disable-line @typescript-eslint/no-explicit-any -- a filter on the builder
  ): PromiseLike<{ count: number | null; error: { message: string } | null; status: number }> =>
    filter(db.from("tender_items").select("id", { count: "exact", head: true }).gte("created_at", since));

  const [
    runRows,
    sourceRows,
    itemRows,
    rejectedRows,
    pendingCount,
    handoffRows,
    stillOpenRows,
    closedCount,
    prefilteredCount,
    classifiedCount,
    matchedCount,
    reviewCount,
    sentCount,
    rejectedCount,
  ] = await Promise.all([
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
    //
    // ⚠️ match/maybe ONLY — the rows grouping reads. It used to be every row in the window,
    // and the window grew past MAX_LIST_ROWS on prefilter rejects alone (1,014 of 1,027 rows
    // on 2026-10-08): ~0.8MB per visit, the cap tripped, and every funnel figure counted off
    // it came out short. pending/error rows are not rendered anywhere (pending is the
    // unwindowed count below), and no_match has its own capped list.
    db
      .from("tender_items")
      .select(ITEM_COLUMNS)
      .gte("created_at", since)
      .in("relevance", ["match", "maybe"])
      .order("created_at", { ascending: false })
      .limit(MAX_LIST_ROWS),
    // The Rejected tab: the newest rejections, WITH their reasoning — auditing the
    // classifier is the tab's whole job, so these are never slimmed to a title.
    db
      .from("tender_items")
      .select(ITEM_COLUMNS)
      .gte("created_at", since)
      .eq("relevance", "no_match")
      .order("created_at", { ascending: false })
      .limit(REJECTED_LIST_ROWS),
    // Queue depth, deliberately NOT windowed: an item stuck pending since last month is
    // exactly what this is for, and hiding it behind the report window would defeat it.
    db.from("tender_items").select("id", { count: "exact", head: true }).eq("relevance", "pending"),
    // Codes are keyed by group, so they join to the cards without touching tender_items.
    db.from("tender_handoffs").select("code, group_key"),
    // ⚠️ Still-open opportunities OLDER than the window. Without this the review list showed
    // 5 of 48 and the other 43 were unreachable — see lib/tenders/actionable.ts. The funnel
    // above stays windowed and these rows never reach it: they are merged into the GROUPS
    // only, so "a fortnight of pipeline activity" and "what is still worth doing" each keep
    // their own, labelled, meaning.
    db
      .from("tender_items")
      .select(ITEM_COLUMNS)
      .lt("created_at", since)
      .in("relevance", ["match", "maybe"])
      .is("forwarded_at", null)
      .neq("status", "archived")
      .or(`closes_at.is.null,closes_at.gte.${new Date(now + MIN_LEAD_TIME_MS).toISOString()}`)
      .order("created_at", { ascending: false })
      .limit(MAX_LIST_ROWS),
    // ⚠️ A COUNT, not a derivation from the rows above. Closed items are never fetched — that
    // is the point of the deadline rule — so counting them in code could only ever see the
    // handful that happen to be inside the window, and would quietly report "3 closed" when
    // the real figure was 27. An undercount presented as a total is worse than no figure.
    // Counts ROWS where the lists count opportunities, so it is labelled "notices".
    db
      .from("tender_items")
      .select("id", { count: "exact", head: true })
      .in("relevance", ["match", "maybe"])
      .is("forwarded_at", null)
      .neq("status", "archived")
      .lt("closes_at", new Date(now + MIN_LEAD_TIME_MS).toISOString()),
    // The funnel — see the note on `funnel` below.
    windowCount((b) => b.eq("classified_by", "prefilter")),
    windowCount((b) => b.eq("classified_by", "anthropic")),
    windowCount((b) => b.eq("relevance", "match")),
    windowCount((b) => b.eq("relevance", "maybe")),
    // ⚠️ Counted, never derived from the match/maybe rows: a no_match row can carry a
    // forwarded_at (one in the window does, 2026-10-08), and it still went to the team.
    windowCount((b) => b.not("forwarded_at", "is", null)),
    windowCount((b) => b.eq("relevance", "no_match")),
  ]);

  // Every tender_items read throws on error — see must(). The run, source and handoff reads
  // keep their old degrade-to-empty behaviour: none of them feeds a count of tenders.
  for (const r of [
    itemRows,
    rejectedRows,
    pendingCount,
    stillOpenRows,
    closedCount,
    prefilteredCount,
    classifiedCount,
    matchedCount,
    reviewCount,
    sentCount,
    rejectedCount,
  ])
    must(r);

  const recent = runRows.data ?? [];
  const items = itemRows.data ?? [];
  // If this ever trips, more match/maybe rows arrived in the window than the cap, and the
  // opportunity lists (not the funnel, which is counted) are short. Surfaced, not hidden.
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
   * Counting the item rows removes the class of bug rather than the instance. They are
   * COUNT queries over the same window rather than a tally of a fetched list: tallying a
   * list capped at MAX_LIST_ROWS is how the funnel went short the moment the window held
   * more rows than the cap. `npm run check:summary` asserts each figure equals a direct row
   * count AND that the matched figure equals the matches listed on screen. Only
   * fetched/fresh/duplicate stay on the run counters, because those are genuinely facts
   * about a fetch and nothing else records them.
   */
  const fetchCounters = recent.reduce(
    (acc, r) => ({
      fetched: acc.fetched + ((r.items_fetched as number) ?? 0),
      fresh: acc.fresh + ((r.items_new as number) ?? 0),
      duplicate: acc.duplicate + ((r.items_duplicate as number) ?? 0),
    }),
    { fetched: 0, fresh: 0, duplicate: 0 }
  );

  const funnel = {
    ...fetchCounters,
    prefiltered: prefilteredCount.count ?? 0,
    classified: classifiedCount.count ?? 0,
    matched: matchedCount.count ?? 0,
    review: reviewCount.count ?? 0,
    sent: sentCount.count ?? 0,
  };

  const toItemView = (i: (typeof items)[number]): ItemView => ({
    id: i.id as string,
    title: i.title as string,
    agency: (i.agency as string | null) ?? null,
    siteLocation: (i.site_location as string | null) ?? null,
    contact: (i.contact as string | null) ?? null,
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
    emailFrom: ((i.email_from as string | null) ?? null) || null,
    injectionSuspected: (i.injection_suspected as boolean) ?? false,
    forwardedAt: (i.forwarded_at as string | null) ?? null,
    status: (i.status as string) ?? "new",
    reviewedAt: (i.reviewed_at as string | null) ?? null,
    createdAt: i.created_at as string,
  });

  const itemViews: ItemView[] = items.map(toItemView);

  // Merged for GROUPING only. Windowed rows win on id, so a row that is both recent and still
  // open is not counted twice.
  const seen = new Set(itemViews.map((i) => i.id));
  const groupable: ItemView[] = [
    ...itemViews,
    ...((stillOpenRows.data ?? []) as typeof items).map(toItemView).filter((i) => !seen.has(i.id)),
  ];

  // Only match/maybe are grouped — a no_match row is never an opportunity. Both queries
  // already fetch nothing else; the filter below keeps that true if one of them is widened.
  const codeByGroup = new Map(
    ((handoffRows.data ?? []) as { code: string; group_key: string }[]).map((h) => [h.group_key, h.code])
  );

  const allGroups = groupItems(
    groupable.filter((i) => i.relevance === "match" || i.relevance === "maybe")
  )
    .map(toGroupView)
    // Attached after grouping: toGroupView is module scope and cannot see this request's map.
    // ⚠️ Any of the MERGED keys, not just g.key. A code was stored against whatever key the
    // opportunity had when it was sent, and the cross-source merge can change which key wins.
    .map((g) => ({
      ...g,
      handoffCode: g.mergedKeys.map((k) => codeByGroup.get(k)).find(Boolean) ?? null,
    }));

  // A tender that closes inside MIN_LEAD_TIME cannot realistically be priced and submitted, so
  // it is not work — it is noise on the one screen that is meant to be a work queue. Dropped
  // from the list and COUNTED, never silently discarded: the count is reported under the
  // filter row so "where did it go" has an answer on screen.
  //
  // This is also what clears the backlog without anyone triaging it. On the live queue all 27
  // tracking-URL junk rows carried a closing date and every one had passed.
  const groups = allGroups.filter((g) => g.state !== "queue" || isActionable(g.lead.closesAt, now));

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
      /** Opportunities whose closing date passed before anyone looked. Reported, not hidden. */
      closedUnreviewed: closedCount.count ?? 0,
    },
    queues: {
      pending: pendingCount.count ?? 0,
      stalled,
    },
    funnel,
    sources,
    items: itemViews,
    /** The newest REJECTED_LIST_ROWS rejections in the window — a list, not a total. */
    rejected: ((rejectedRows.data ?? []) as typeof items).map(toItemView),
    /** Every rejection in the window, counted. What the Rejected tab's label shows. */
    rejectedTotal: rejectedCount.count ?? 0,
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
 * `sent` beats `dismissed` too. A send is a fact — an email went to the team and a handoff code
 * may be in Salesforce — while a dismissal is a judgement; filing a sent job under Dismissed
 * hides the one thing anyone needs to know about it. Dismiss leaves sent rows alone since
 * 2026-10-08 (app/api/tenders/send/route.ts), so this is the second guard, for rows archived
 * before that or by hand.
 *
 * `dismissed` requires EVERY member archived. Dismissing one copy of a five-copy job is a
 * judgement about that email, not about the opportunity.
 */
function groupState(members: ItemView[]): GroupView["state"] {
  if (members.some((m) => m.forwardedAt !== null)) return "sent";
  if (members.every((m) => m.status === "archived")) return "dismissed";
  return "queue";
}

/** Everything about a group except the handoff code, which is attached by the caller —
 *  this function is module scope and the code map is per request. */
function toGroupView(g: ItemGroup<ItemView>): Omit<GroupView, "handoffCode"> {
  // Deduped by source, keeping the most confident copy's link for each — a reader following
  // one of these wants the notice, not whichever reminder happened to arrive last.
  const bySource = new Map<string, { label: string; url: string | null }>();
  for (const m of [...g.members].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))) {
    if (!bySource.has(m.source)) bySource.set(m.source, { label: m.source, url: m.url });
  }

  const firstOf = (pick: (m: ItemView) => string | null): string | null => {
    for (const m of g.members) {
      const v = pick(m)?.trim();
      if (v) return v;
    }
    return null;
  };

  return {
    key: g.key,
    mergedKeys: g.mergedKeys,
    state: groupState(g.members),
    count: g.count,
    siteLocation: firstOf((m) => m.siteLocation),
    // The RAW address. A robot sender is suppressed as a CONTACT but still shown as
    // provenance, so the filtering belongs at the point of render, not here.
    emailFrom: firstOf((m) => m.emailFrom),
    contact: firstOf((m) => m.contact),
    title: displayTitle({ title: g.lead.title, agency: g.lead.agency, summary: g.lead.summary }),
    lead: g.lead,
    members: g.members,
    sources: [...bySource.values()],
  };
}
