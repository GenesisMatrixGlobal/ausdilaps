/**
 * The daily redundancy sweep: is the same tender reaching us from more than one source?
 *
 * ── Why a WATCH and not a fix ─────────────────────────────────────────────────────────────
 *
 * Measured over 748 items on the day this was written: 610 distinct opportunities, 16
 * repeating inside a single source, and **zero** spanning two. That zero was checked twice —
 * once by the exact grouping key, then again fuzzily, because different portals word the same
 * tender differently and an exact key would report zero either way. 43 cross-source pairs
 * share a closing date and not one is the same job.
 *
 * So there is nothing to suppress today. What changes that is the overlap we have just
 * created: VendorPanel carries ~250 councils, Buying for Victoria carries VIC agencies, and
 * TenderSearch aggregates both. The moment one council's tender arrives twice, an estimator
 * reviews it twice — and nothing in the pipeline would say so, because `groupItems` collapses
 * on an exact normalised title and these sources do not agree on wording.
 *
 * This reports rather than merges, deliberately. Auto-merging two records from different
 * portals means picking one link and one closing date to keep, and being wrong there is worse
 * than showing a duplicate: the reviewer loses the copy that had the right deadline.
 */

/** Words worth comparing. Short words carry no signal and appear in every tender title. */
function words(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

/** Overlap of two word sets, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared);
}

/**
 * How alike two titles must be before this calls them the same tender.
 *
 * Deliberately generous. A false positive costs one line on a report a person reads; a false
 * negative is the duplicate review this exists to catch. 0.4 flags nothing across the current
 * 43 same-deadline cross-source pairs, so it is not noisy on real data.
 */
export const SAME_TENDER_AT = 0.4;

export type RedundantPair = {
  similarity: number;
  closesAt: string;
  left: { id: string; title: string; source: string };
  right: { id: string; title: string; source: string };
};

export type Candidate = {
  id: string;
  title: string;
  source_slug: string;
  closes_at: string | null;
};

/**
 * Pairs of items from DIFFERENT sources that look like one tender.
 *
 * ⚠️ Compared only WITHIN a closing date. Two tenders closing on different days are two
 * tenders whatever their titles say, and pairing every item against every other is O(n²) over
 * a fortnight's intake — the date buckets it into something that stays cheap as the source
 * list grows, which is the direction this is going.
 */
export function findRedundant(items: Candidate[]): RedundantPair[] {
  const byDate = new Map<string, Candidate[]>();
  for (const item of items) {
    if (!item.closes_at) continue; // nothing to bucket on, and no way to be confident
    const day = item.closes_at.slice(0, 10);
    byDate.set(day, [...(byDate.get(day) ?? []), item]);
  }

  const pairs: RedundantPair[] = [];
  for (const [day, list] of byDate) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].source_slug === list[j].source_slug) continue; // within-source is group's job
        const similarity = titleSimilarity(list[i].title, list[j].title);
        if (similarity < SAME_TENDER_AT) continue;
        pairs.push({
          similarity,
          closesAt: day,
          left: { id: list[i].id, title: list[i].title, source: list[i].source_slug },
          right: { id: list[j].id, title: list[j].title, source: list[j].source_slug },
        });
      }
    }
  }

  return pairs.sort((a, b) => b.similarity - a.similarity);
}
