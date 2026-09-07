/**
 * Collapsing the same tender arriving many times into one opportunity.
 *
 * ── Why this is not deduplication ────────────────────────────────────────────────────────
 *
 * There IS a suppression path at ingest (suppressIfDuplicate in scan.ts) and it has never
 * once fired, because it carries `.neq("source_slug", ...)` — it only looks ACROSS sources,
 * while nearly every real duplicate arrives WITHIN one. Felix sends a reminder for the same
 * job every few days and each carries a fresh tracking URL, so external_ref differs; two of
 * the five copies of one job also differ by content_hash because the digest body around them
 * changed. No storage-level key collapses them.
 *
 * The fix is not a better ingest key. Storage-level dedupe is irreversible: pick the rule
 * slightly wrong and a real tender is discarded with no trace that it ever existed, which
 * for this business is a lost job. So grouping happens at READ time and every row survives.
 * A wrong grouping shows up as one card carrying two links — visible, and harmless.
 *
 * ── The key ──────────────────────────────────────────────────────────────────────────────
 *
 * Normalised title + the closing DATE. Verified against the live table: 24 match rows
 * collapse to exactly 15 groups, which is the number a human counts.
 *
 * Not content_hash: it splits the five copies of "126379 - Dilapidation Survey" into three.
 * Not the URL: every copy has a different one, which is the whole problem.
 * Not the source: the same job legitimately arrives from Seymour Whyte AND as an internal
 * forward from ausdilaps.com.au, and those should read as one opportunity.
 */

/** Members always carry at least the fields the key is built from. */
export type Groupable = {
  id: string;
  title: string;
  closesAt?: string | null;
  closes_at?: string | null;
  confidence?: number | null;
  createdAt?: string | null;
  created_at?: string | null;
};

export type ItemGroup<T> = {
  /** Stable across renders and safe as a React key or a form value. */
  key: string;
  /** The row shown as the headline — highest confidence, newest as the tie-break. */
  lead: T;
  /** Every row in the group, lead included. Never a subset: nothing is dropped. */
  members: T[];
  /** members.length. Rendered as "seen 5x" once above 1. */
  count: number;
};

const closingOf = (i: Groupable) => i.closesAt ?? i.closes_at ?? null;
const createdOf = (i: Groupable) => i.createdAt ?? i.created_at ?? "";

/**
 * Title, reduced to the part that identifies the job.
 *
 * Punctuation goes because the same tender reaches us as "Dilapidation Survey - Properties"
 * and "Dilapidation Survey — Properties" from different senders; the dash is the sender's
 * house style, not part of the name. Digits are KEPT — "126379" is the tender reference and
 * often the only thing distinguishing two otherwise identically-named jobs.
 */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[‐-―]/g, "-") // unicode dashes -> ascii, before punctuation is stripped
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The grouping key.
 *
 * The closing date is a DATE, not a timestamp — the same deadline reaches us as midnight UTC
 * from one portal and 14:00 local from another, and an exact-timestamp key would split them.
 * A missing date contributes an empty segment rather than being skipped, so "no deadline
 * given" never accidentally matches "closes on the 9th".
 */
export function groupKey(item: Groupable): string {
  const closes = closingOf(item);
  return `${normaliseTitle(item.title)}|${closes ? closes.slice(0, 10) : ""}`;
}

/**
 * Group while preserving first-appearance order.
 *
 * Callers hand us a list already sorted the way the user should see it (newest first), and
 * re-sorting here would quietly override that. Groups therefore appear in the position of
 * their earliest member in the input.
 */
export function groupItems<T extends Groupable>(items: readonly T[]): ItemGroup<T>[] {
  const byKey = new Map<string, T[]>();

  for (const item of items) {
    const key = groupKey(item);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(item);
    else byKey.set(key, [item]);
  }

  return [...byKey.entries()].map(([key, members]) => ({
    key,
    lead: pickLead(members),
    members,
    count: members.length,
  }));
}

/**
 * The copy worth showing.
 *
 * Highest confidence first: the same job classified at 0.95 from Seymour Whyte and 0.83 via
 * an internal forward is better represented by the direct one. Newest breaks the tie, so a
 * refreshed notice beats a stale copy of identical confidence.
 */
function pickLead<T extends Groupable>(members: T[]): T {
  return members.reduce((best, candidate) => {
    const a = candidate.confidence ?? 0;
    const b = best.confidence ?? 0;
    if (a !== b) return a > b ? candidate : best;
    return createdOf(candidate) > createdOf(best) ? candidate : best;
  }, members[0]);
}

/** Every id in the selected groups — what the send route marks, not just the leads. */
export function memberIds<T extends Groupable>(groups: readonly ItemGroup<T>[]): string[] {
  return groups.flatMap((g) => g.members.map((m) => m.id));
}
