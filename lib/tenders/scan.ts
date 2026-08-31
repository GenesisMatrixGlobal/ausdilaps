import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapPool } from "@/lib/util/map-pool";
import { classifierConfigured, classifyTender } from "./classify";
import {
  CLASSIFY_CONCURRENCY,
  CLASSIFY_DEADLINE_MS,
  DAILY_CLASSIFY_BUDGET,
  MAX_CLASSIFY_ATTEMPTS,
  MAX_CLASSIFY_PER_RUN,
  MAX_FORWARD_ATTEMPTS,
  STALLED_RUN_MS,
  forwardingEnabled,
} from "./config";
import { externalRefForMessage } from "./dedupe";
import { sendDigest, type DigestAlert, type DigestItem } from "./notify";
import { prefilter } from "./prefilter";
import { enabledSources, SOURCES } from "./sources";
import { discoverMailboxSources, loadEmailSources } from "./sources/mailbox";
import type { RawItem, ScanSummary, SourceRunSummary } from "./types";

/**
 * The nightly scan.
 *
 * Two phases, and the split is the whole reliability story:
 *
 *   Phase A — fetch and persist. Cheap, and must always complete. Every source's raw
 *     payload is written BEFORE its parse is trusted, and every parsed item is upserted as
 *     relevance='pending'. If nothing else runs tonight, no tender is lost.
 *
 *   Phase B — classify and forward. Expensive, and fully resumable: "needs classifying"
 *     and "needs forwarding" are queries against partial indexes, not in-memory state. A
 *     crashed, timed-out or budget-capped run leaves work in the database and the next run
 *     picks it up. There is no retry queue and no dead-letter table — tomorrow's 8pm run
 *     IS the retry.
 */

type Db = ReturnType<typeof createAdminClient>;

/**
 * A hard platform timeout kills the process with no chance to write finished_at, so a
 * 'running' row older than the threshold is the only trace it leaves. Without this they
 * accumulate forever and the dashboard's "stalled" count becomes meaningless.
 */
export async function reapStalledRuns(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - STALLED_RUN_MS).toISOString();
  const { data, error } = await db
    .from("tender_scan_runs")
    .update({
      status: "failed",
      error: "no heartbeat — presumed timed out",
      finished_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("started_at", cutoff)
    .select("id");

  if (error) {
    console.error("[tenders] reapStalledRuns failed:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

/** Output tokens are not the constraint here; runaway item volume is. */
async function classifiedInLast24h(db: Db): Promise<number> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data, error } = await db
    .from("tender_scan_runs")
    .select("items_classified")
    .gte("started_at", since);
  if (error || !data) return 0;
  return data.reduce((sum, r) => sum + (r.items_classified ?? 0), 0);
}

async function updateSourceHealth(
  db: Db,
  slug: string,
  patch: { ok: boolean; itemCount: number; error?: string | null }
) {
  const { data: current } = await db
    .from("tender_sources")
    .select("consecutive_failures, consecutive_empty")
    .eq("slug", slug)
    .maybeSingle();

  const now = new Date().toISOString();
  await db
    .from("tender_sources")
    .update({
      last_run_at: now,
      ...(patch.ok ? { last_success_at: now } : {}),
      ...(patch.itemCount > 0 ? { last_item_at: now } : {}),
      consecutive_failures: patch.ok ? 0 : (current?.consecutive_failures ?? 0) + 1,
      // The silent-failure counter. A portal that quietly drops us off its alert list
      // produces zero errors and a green run; only this catches it.
      consecutive_empty: patch.itemCount > 0 ? 0 : (current?.consecutive_empty ?? 0) + 1,
      last_error: patch.error ?? null,
    })
    .eq("slug", slug);
}

/** Every item write goes through the RPC, which owns the careful `on conflict` clause. */
async function upsertItem(db: Db, item: RawItem, runId: string): Promise<{ id: string; isNew: boolean } | null> {
  const { data, error } = await db.rpc("tender_upsert_item", {
    p: {
      source_slug: item.sourceSlug,
      external_ref: item.externalRef,
      content_hash: item.contentHash ?? "",
      title: item.title,
      agency: item.agency ?? "",
      jurisdiction: item.jurisdiction ?? "",
      url: item.url ?? "",
      published_at: item.publishedAt ?? "",
      closes_at: item.closesAt ?? "",
      excerpt: item.excerpt ?? "",
      email_message_id: item.emailMessageId ?? "",
      email_from: item.emailFrom ?? "",
      auth_results: item.authResults ?? "",
      sender_trusted: item.senderTrusted ?? false,
      run_id: runId,
    },
  });

  if (error) {
    console.error("[tenders] upsert failed:", item.externalRef, error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { id: row.id as string, isNew: row.is_new as boolean } : null;
}

/**
 * Soft-links a tender we have already seen from another source.
 *
 * Both rows are kept — losing the second source's URL would be a real loss, and two
 * councils genuinely do both publish "Dilapidation Survey Services". The 30-day window
 * stops a genuinely annual tender being suppressed forever.
 */
async function suppressIfDuplicate(db: Db, id: string, contentHash: string | null | undefined, sourceSlug: string) {
  if (!contentHash) return false;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const { data } = await db
    .from("tender_items")
    .select("id, relevance, confidence, services, model_summary, model_reasoning")
    .eq("content_hash", contentHash)
    .neq("source_slug", sourceSlug)
    .neq("id", id)
    .gte("created_at", since)
    .limit(1);

  const parent = data?.[0];
  if (!parent) return false;

  await db
    .from("tender_items")
    .update({
      duplicate_of: parent.id,
      // A duplicate classifies identically by definition, so copy rather than pay again.
      relevance: parent.relevance,
      confidence: parent.confidence,
      services: parent.services,
      model_summary: parent.model_summary,
      model_reasoning: parent.model_reasoning,
      classified_by: "duplicate",
      classified_at: new Date().toISOString(),
      // Suppress the forward without pretending it was delivered.
      forwarded_at: new Date().toISOString(),
      forward_error: `suppressed: duplicate of ${parent.id}`,
    })
    .eq("id", id);

  return true;
}

/** Phase A for one source. Never throws — a bad source must not take the run down. */
async function scanSource(
  db: Db,
  source: ReturnType<typeof enabledSources>[number],
  runGroupId: string,
  triggeredBy: "cron" | "manual" | "replay"
): Promise<SourceRunSummary> {
  const started = Date.now();

  const { data: runRow, error: runError } = await db
    .from("tender_scan_runs")
    .insert({
      run_group_id: runGroupId,
      source_slug: source.slug,
      triggered_by: triggeredBy,
      status: "running",
    })
    .select("id")
    .single();

  if (runError || !runRow) {
    // Supabase is the source of truth; if we cannot even record the run, do not do work
    // we would have no record of.
    throw new Error(`Could not open scan run for ${source.slug}: ${runError?.message}`);
  }

  const runId = runRow.id as string;
  const summary: SourceRunSummary = {
    runId,
    sourceSlug: source.slug,
    label: source.label,
    status: "succeeded",
    itemsFetched: 0,
    itemsNew: 0,
    itemsDuplicate: 0,
  };

  try {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { raw, items } = await source.fetch(since);

    // Raw goes down FIRST, whether or not the parse produced anything. This is what makes
    // a format change recoverable: a fixed parser can be replayed over stored payloads
    // instead of the intervening tenders being lost.
    await db.from("tender_scan_runs").update({ raw_payload: raw }).eq("id", runId);

    let effective = items;

    // The zero-item alarm. A digest source that parses to nothing is never a quiet day —
    // it means the portal changed format, or dropped us. Emit one fallback item carrying
    // the whole payload so a human sees it tonight, and never report success.
    if (items.length === 0 && source.kind === "email") {
      summary.status = "partial";
      const body = typeof raw === "string" ? raw : JSON.stringify(raw);
      effective = [
        {
          sourceSlug: source.slug,
          externalRef: externalRefForMessage("", `${source.slug}:${new Date().toISOString().slice(0, 10)}`),
          title: `${source.label} — digest parsed to zero items`,
          excerpt: body.slice(0, 12_000),
          senderTrusted: false,
        },
      ];
      await db
        .from("tender_scan_runs")
        .update({ error: "digest parsed to zero items" })
        .eq("id", runId);
    }

    summary.itemsFetched = items.length;

    for (const item of effective) {
      const result = await upsertItem(db, item, runId);
      if (!result) continue;
      if (result.isNew) {
        summary.itemsNew++;
        if (await suppressIfDuplicate(db, result.id, item.contentHash, item.sourceSlug)) {
          summary.itemsDuplicate++;
          summary.itemsNew--;
        }
      }
    }

    await updateSourceHealth(db, source.slug, { ok: true, itemCount: items.length });
  } catch (e) {
    summary.status = "failed";
    summary.error = (e as Error).message;
    console.error(`[tenders] source ${source.slug} failed:`, summary.error);
    await updateSourceHealth(db, source.slug, { ok: false, itemCount: 0, error: summary.error });
  }

  await db
    .from("tender_scan_runs")
    .update({
      status: summary.status,
      items_fetched: summary.itemsFetched,
      items_new: summary.itemsNew,
      items_duplicate: summary.itemsDuplicate,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      ...(summary.error ? { error: summary.error } : {}),
    })
    .eq("id", runId);

  return summary;
}

/**
 * Make sure every registered source has a row in tender_sources.
 *
 * tender_scan_runs.source_slug has a foreign key to it, so a source added to
 * lib/tenders/sources.ts without a matching row fails on its first run with an FK
 * violation — which reads as "the portal is broken", not "somebody forgot a migration".
 *
 * Seeding from the code registry is the right way round: 0006's design note says code owns
 * WHAT a source is and the table only remembers how it has been BEHAVING. This keeps that
 * true as portals get added, and it matters because more are expected — requiring a
 * migration per portal is exactly the friction that gets skipped.
 *
 * `do nothing` on conflict, deliberately: never overwrite is_enabled or the health
 * counters an operator has been watching.
 */
async function ensureSourceRows(db: Db): Promise<void> {
  const rows = SOURCES.map((s) => ({ slug: s.slug, label: s.label, kind: s.kind }));
  const { error } = await db.from("tender_sources").upsert(rows, {
    onConflict: "slug",
    ignoreDuplicates: true,
  });
  // Not fatal: an existing source can still run. Only a brand-new one would fail, and it
  // will fail loudly on its own run row.
  if (error) console.error("[tenders] ensureSourceRows failed:", error.message);
}

export async function runScan(opts: { triggeredBy?: "cron" | "manual" | "replay" } = {}): Promise<ScanSummary> {
  const triggeredBy = opts.triggeredBy ?? "cron";
  const runGroupId = randomUUID();
  const db = createAdminClient();
  const deadline = Date.now() + CLASSIFY_DEADLINE_MS;

  await reapStalledRuns(db);
  await ensureSourceRows(db);

  // Discovery first, and it must be first: a sender domain with no row yet has no source,
  // so nothing would ever fetch its mail. This creates the row; the load below picks it up
  // in the same run, so a new portal's first email is classified the night it arrives
  // rather than the night after.
  //
  // Both reuse the memoised mailbox fetch, so this costs no extra Graph call.
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  await discoverMailboxSources(db, since);

  const sources = [...enabledSources(), ...(await loadEmailSources(db))];
  const result: ScanSummary = {
    runGroupId,
    status: "succeeded",
    sources: [],
    itemsClassified: 0,
    itemsMatched: 0,
    itemsForwarded: 0,
    itemsErrored: 0,
    pendingRemaining: 0,
    notified: false,
  };

  if (sources.length === 0) {
    return { ...result, status: "skipped", error: "No sources are configured." };
  }

  // ── Phase A — fetch + persist ────────────────────────────────────────
  for (const source of sources) {
    const summary = await scanSource(db, source, runGroupId, triggeredBy);
    result.sources.push(summary);
  }
  if (result.sources.some((s) => s.status !== "succeeded")) result.status = "partial";

  // ── Phase B — classify ───────────────────────────────────────────────
  if (!classifierConfigured()) {
    result.status = "partial";
    result.error = "ANTHROPIC_API_KEY not configured — items left pending.";
    console.error("[tenders] classifier not configured; items left pending");
    return result;
  }

  const spent = await classifiedInLast24h(db);
  if (spent >= DAILY_CLASSIFY_BUDGET) {
    result.status = "partial";
    result.error = `Daily classification budget reached (${spent}/${DAILY_CLASSIFY_BUDGET}) — items left pending.`;
    console.error(`[tenders] ${result.error}`);
    return result;
  }

  const budgetLeft = Math.min(MAX_CLASSIFY_PER_RUN, DAILY_CLASSIFY_BUDGET - spent);
  const { data: pending } = await db
    .from("tender_items")
    .select("id, source_slug, external_ref, title, excerpt, url, agency, email_from, published_at, classify_attempts")
    .eq("relevance", "pending")
    .lt("classify_attempts", MAX_CLASSIFY_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(budgetLeft);

  const queue = pending ?? [];

  // The prefilter runs first and costs nothing. Rejections are still written as rows so
  // items_prefiltered on the dashboard makes an over-aggressive filter visible.
  const needsModel: typeof queue = [];
  for (const row of queue) {
    if (prefilter({ title: row.title, excerpt: row.excerpt })) {
      needsModel.push(row);
    } else {
      await db
        .from("tender_items")
        .update({
          relevance: "no_match",
          confidence: 0,
          classified_by: "prefilter",
          classified_at: new Date().toISOString(),
          model_reasoning: "No service keyword present; rejected before classification.",
        })
        .eq("id", row.id);
    }
  }

  const prefiltered = queue.length - needsModel.length;

  await mapPool(needsModel, CLASSIFY_CONCURRENCY, async (row) => {
    // The self-imposed deadline sits ~50s inside the route's maxDuration. That gap is the
    // difference between a run that reports "N left pending" and one the platform kills
    // without it ever writing finished_at.
    if (Date.now() > deadline) return;

    const outcome = await classifyTender({
      sourceSlug: row.source_slug,
      externalRef: row.external_ref,
      title: row.title,
      excerpt: row.excerpt ?? "",
      url: row.url,
      agency: row.agency,
      emailFrom: row.email_from,
      publishedAt: row.published_at,
    });

    if (!outcome.ok) {
      result.itemsErrored++;
      await db
        .from("tender_items")
        .update({
          classify_attempts: (row.classify_attempts ?? 0) + 1,
          classify_error: outcome.error.slice(0, 2000),
          // Only give up permanently once the attempt cap is hit; until then it stays
          // pending and the next run retries it.
          ...((row.classify_attempts ?? 0) + 1 >= MAX_CLASSIFY_ATTEMPTS
            ? { relevance: "error" as const }
            : {}),
        })
        .eq("id", row.id);
      return;
    }

    const c = outcome.classification;
    result.itemsClassified++;
    if (c.relevance === "match") result.itemsMatched++;

    await db
      .from("tender_items")
      .update({
        relevance: c.relevance,
        confidence: c.confidence,
        services: c.services,
        model_summary: c.summary,
        model_reasoning: c.reasoning,
        model: outcome.model,
        classified_by: "anthropic",
        classified_at: new Date().toISOString(),
        classify_attempts: (row.classify_attempts ?? 0) + 1,
        classify_error: null,
        injection_suspected: c.injectionSuspected,
        title: outcome.extracted.title || row.title,
        agency: outcome.extracted.agency ?? row.agency,
        jurisdiction: outcome.extracted.jurisdiction,
        closes_at: outcome.extracted.closesAt,
      })
      .eq("id", row.id);
  });

  const { count: stillPending } = await db
    .from("tender_items")
    .select("id", { count: "exact", head: true })
    .eq("relevance", "pending");
  result.pendingRemaining = stillPending ?? 0;

  // ── Phase B — forward ────────────────────────────────────────────────
  await forwardPending(db, result, prefiltered);

  return result;
}

/**
 * Builds and sends the digest, then marks what went out.
 *
 * Send FIRST, mark second. The reverse ordering risks an item that looks forwarded but
 * never was — a silent miss — whereas this ordering risks a duplicate, which is noisy and
 * harmless. For a business where a missed tender is a lost job that is not a close call.
 * The Resend Idempotency-Key in notify.ts closes most of the duplicate window anyway.
 */
async function forwardPending(db: Db, result: ScanSummary, prefiltered: number) {
  const { data: unforwarded } = await db
    .from("tender_items")
    .select(
      "id, title, agency, url, closes_at, relevance, confidence, services, model_summary, model_reasoning, source_slug, sender_trusted, injection_suspected, forward_attempts"
    )
    .in("relevance", ["match", "maybe"])
    .is("forwarded_at", null)
    .lt("forward_attempts", MAX_FORWARD_ATTEMPTS)
    .order("confidence", { ascending: false })
    .limit(25);

  // Flag any source that has gone quiet. A dead source is precisely when we DO want an
  // email, even though a nothing-found night gets none.
  const { data: quiet } = await db
    .from("tender_sources")
    .select("label, consecutive_empty, consecutive_failures")
    .or("consecutive_empty.gte.3,consecutive_failures.gte.1");

  const alerts: DigestAlert[] = (quiet ?? []).map((s) => ({
    sourceLabel: s.label as string,
    message:
      (s.consecutive_failures ?? 0) > 0
        ? `${s.consecutive_failures} failed run(s) in a row.`
        : `No items for ${s.consecutive_empty} runs. Worth checking we are still on their alert list.`,
  }));

  // Two exclusions from the digest, both of which still leave the item visible in the tool:
  //   - injection_suspected: an attack becomes a flagged row a human reviews, never an
  //     email sent under our own signed domain.
  //   - untrusted sender: anyone can email the monitored inbox. Off by default for week
  //     one; TENDER_FORWARD_UNTRUSTED=true turns it on once real mail has been seen.
  //     Feed items set sender_trusted at ingest, so this never touches RSS.
  const allowUntrusted = process.env.TENDER_FORWARD_UNTRUSTED === "true";
  const items = (unforwarded ?? []).filter(
    (i) => i.injection_suspected !== true && (allowUntrusted || i.sender_trusted === true)
  );

  // No "nothing found today" emails — people stop reading those. But a quiet source is
  // exactly the case that must still reach someone.
  if (items.length === 0 && alerts.length === 0) return;

  const scanned = result.sources.reduce((n, s) => n + s.itemsFetched, 0) + prefiltered;

  const digestItems: DigestItem[] = items.map((i) => ({
    id: i.id as string,
    title: i.title as string,
    agency: i.agency as string | null,
    url: i.url as string | null,
    closesAt: i.closes_at as string | null,
    relevance: i.relevance as "match" | "maybe",
    confidence: i.confidence as number | null,
    services: (i.services as string[]) ?? [],
    summary: i.model_summary as string | null,
    reasoning: i.model_reasoning as string | null,
    sourceLabel: i.source_slug as string,
    senderTrusted: (i.sender_trusted as boolean) ?? false,
    injectionSuspected: (i.injection_suspected as boolean) ?? false,
  }));

  if (!forwardingEnabled()) {
    // Shadow mode: the pipeline runs in full and sends nothing, so a week of output can be
    // read against the real inbox before anyone trusts it.
    console.warn(`[tenders] shadow mode — ${digestItems.length} item(s) not sent (TENDER_FORWARD_ENABLED=false)`);
    return;
  }

  const send = await sendDigest({
    items: digestItems,
    alerts,
    scanned,
    sources: result.sources.length,
    testMode: process.env.TENDER_TEST_MODE === "true",
  });

  const now = new Date().toISOString();
  for (const item of digestItems) {
    await db
      .from("tender_items")
      .update(
        send.sent
          ? { forwarded_at: now, forward_error: null }
          : {
              forward_attempts: (unforwarded?.find((u) => u.id === item.id)?.forward_attempts ?? 0) + 1,
              forward_error: send.error?.slice(0, 500) ?? "unknown",
            }
      )
      .eq("id", item.id);
  }

  if (send.sent) {
    result.notified = true;
    result.itemsForwarded = digestItems.length;
  } else {
    // Never report green when matches did not reach anyone.
    result.status = "partial";
    result.error = send.error;
  }
}
