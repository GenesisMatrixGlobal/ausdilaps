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
 * Normalised title + the closing DATE, falling back to the agency when the title is a bare
 * tracking URL (see groupKey). Verified against the live table: 24 match rows collapse to 9
 * opportunities, and the whole match/maybe queue from 41 rows to 12.
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
  agency?: string | null;
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
 *
 * ⚠️ When the title is a bare tracking URL, the key falls back to the AGENCY.
 *
 * Without that fallback the key is useless on exactly the rows that need it most. TenderSearch
 * is the highest-volume source and its bulletin is currently parsed as N copies of the whole
 * digest (see displayTitle below), so N rows arrive describing one tender, each titled with its
 * own unique tracking URL. Keying on the title left eleven separate cards for a single
 * Queensland Health job — a queue of 32 cards covering about eight real opportunities, which
 * is the pile-up this module exists to prevent.
 *
 * Agency + closing date is a blunter key and can merge two genuinely different jobs from one
 * agency closing on one day. That is an acceptable trade only because grouping never deletes:
 * such a merge shows as one card carrying both links and an "arrived 2 times" line, so the
 * second tender is still reachable. The real fix is the parser; this keeps the tool usable
 * until then.
 */
export function groupKey(item: Groupable): string {
  const closes = closingOf(item);
  const title = normaliseTitle(item.title);
  const isUrlTitle = /^https?\s/.test(title) || /^https?:\/\//i.test(item.title?.trim() ?? "");
  const agency = normaliseTitle(item.agency ?? "");
  // Only fall back when there IS an agency — otherwise every untitled row from every source
  // would collapse into one card keyed on the empty string.
  const identity = isUrlTitle && agency ? `agency:${agency}` : title;
  return `${identity}|${closes ? closes.slice(0, 10) : ""}`;
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

/**
 * A title fit to put in front of a person.
 *
 * ⚠️ Some stored titles are a bare tracking URL. That is NOT this function's fault to fix
 * properly — it is a symptom of the TenderSearch bulletin being parsed as N copies of the
 * whole digest (see docs/tender-watch.md, "Known: bulletin parsing"). The classifier is
 * handed a body containing 14 notices, correctly declines to name "the" tender, returns an
 * empty title, and scan.ts falls back to the parsed anchor text — which for TenderSearch is
 * the href itself.
 *
 * Until the parser is fixed, the agency and the model's summary are the only usable
 * identifiers on those rows, and both are present. Rendering
 * "https://link.tendersearch.com.au/token/C7E003F7-…" in a handoff email would make the
 * whole feature useless, so this reconstructs something readable. The stored title is never
 * modified — this is display only, and re-running a fixed parser must be able to overwrite
 * the real thing. groupKey() handles the same rows by falling back to the agency.
 */
export function displayTitle(item: {
  title: string;
  agency?: string | null;
  summary?: string | null;
  model_summary?: string | null;
}): string {
  const title = item.title?.trim() ?? "";
  if (!/^https?:\/\//i.test(title)) return title;

  const summary = (item.summary ?? item.model_summary ?? "").trim();
  // First clause of the summary — enough to identify the job, short enough for a subject line.
  const clause = summary.split(/(?<=[.;])\s|\.\s|\s[–—]\s/)[0]?.trim().replace(/\.$/, "") ?? "";
  const agency = item.agency?.trim();

  if (agency && clause) return `${agency} — ${truncate(clause, 120)}`;
  if (clause) return truncate(clause, 140);
  if (agency) return agency;
  return "Untitled tender";
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Every id in the selected groups — what the send route marks, not just the leads. */
export function memberIds<T extends Groupable>(groups: readonly ItemGroup<T>[]): string[] {
  return groups.flatMap((g) => g.members.map((m) => m.id));
}
