import type { DepartmentSlug } from "@/lib/departments";

/**
 * Which staff departments see Tender Watch.
 *
 * Read by the API routes so access can never drift between the page and its data. This list
 * MUST match the `departments` on the tender-watch entry in lib/tools/registry.ts — otherwise
 * a department gets a tool card whose data calls then 401.
 *
 * The routes ALSO allow company admins outright, independently of this list. That was
 * load-bearing while this was empty (isStaffInAnyDepartment([]) is false for everyone, admins
 * included), and it is still what adds the operator panels on top of the ordinary view.
 */
export const TENDER_WATCH_DEPARTMENTS: readonly DepartmentSlug[] = ["accounts"];

/** Dev-only unauth hatch for the read routes. IGNORED in production — see lib/auth/is-staff.ts. */
export const TENDER_WATCH_ALLOW_UNAUTHED_ENV = "TENDER_WATCH_ALLOW_UNAUTHED";

/** Per-invocation ceiling on Anthropic calls, so an inbox flood cannot run up a bill. */
export const MAX_CLASSIFY_PER_RUN = Number(process.env.TENDER_MAX_CLASSIFY_PER_RUN ?? 60);

/** 24-hour circuit breaker across all runs. Exceeded => the run is skipped, loudly. */
export const DAILY_CLASSIFY_BUDGET = Number(process.env.TENDER_DAILY_CLASSIFY_BUDGET ?? 200);

/**
 * Self-imposed deadline for the classify phase, well inside the route's maxDuration of
 * 290s. The gap is what lets a run *report* "12 left pending" instead of being hard-killed
 * by the platform and vanishing without writing finished_at.
 */
export const CLASSIFY_DEADLINE_MS = 240_000;

/** Bounded concurrency for classification. Polite to the API, and cheap to reason about. */
export const CLASSIFY_CONCURRENCY = 3;

/**
 * How far back a scan looks.
 *
 * Three days, not one, and it costs nothing extra: an item already stored is recognised by
 * its external_ref and never re-classified, so a wider window re-reads mail we have already
 * judged without paying for it again. What it buys is that a missed night — a deploy, an
 * outage, an expired secret — heals itself on the next run instead of leaving a silent hole
 * in the record.
 *
 * Raise it with TENDER_LOOKBACK_DAYS, or pass lookbackDays to runScan() for a one-off
 * backfill. Capped so a typo can't ask Graph for a decade of mail.
 */
export const LOOKBACK_DAYS = Math.min(
  Math.max(Number(process.env.TENDER_LOOKBACK_DAYS ?? 3), 1),
  60
);
export const MAX_LOOKBACK_DAYS = 60;

/** Every outbound fetch gets this, so one hung feed cannot eat the whole time budget. */
export const FETCH_TIMEOUT_MS = 20_000;

/** A 'running' row older than this had its process killed mid-flight. See reapStalledRuns(). */
export const STALLED_RUN_MS = 30 * 60_000;

/** Give up re-trying a single item after this many attempts, rather than nightly forever. */
export const MAX_CLASSIFY_ATTEMPTS = 5;
export const MAX_FORWARD_ATTEMPTS = 5;

/** Week-1 shadow mode: run the whole pipeline, send nothing. */
export function forwardingEnabled(): boolean {
  return process.env.TENDER_FORWARD_ENABLED === "true";
}
