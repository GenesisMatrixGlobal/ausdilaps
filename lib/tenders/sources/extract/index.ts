import { extractFelix } from "./felix";
import { extractTenderSearch } from "./tendersearch";
import type { ExtractSource, ExtractedNotice, Extractor } from "./types";

export type { ExtractSource, ExtractedNotice, Extractor } from "./types";

/**
 * Sender domain -> extractor.
 *
 * A suffix match, so `mail.felix.net` and `felix.net` both resolve. Adding a portal here is
 * purely an upgrade: without an entry the generic parser handles it exactly as before, which
 * is what keeps domain-based discovery working for portals nobody has written code for.
 */
const EXTRACTORS: Record<string, Extractor> = {
  "tendersearch.com.au": extractTenderSearch,
  "felix.net": extractFelix,
};

export function extractorFor(domain: string | null | undefined): Extractor | null {
  if (!domain) return null;
  const d = domain.toLowerCase();
  for (const [suffix, extractor] of Object.entries(EXTRACTORS)) {
    if (d === suffix || d.endsWith(`.${suffix}`)) return extractor;
  }
  return null;
}

/**
 * Run the matching extractor, or return null to mean "use the generic parser".
 *
 * NEVER THROWS. An extractor is a pile of regexes over someone else's HTML, and that HTML
 * changes without notice. If a format shift turned into an exception here it would take down
 * the whole source's run — every notice in the mailbox lost for the night, and the nightly
 * scan is the only thing that reads it. Falling back to the generic parser instead costs
 * accuracy for one sender and loses nothing.
 *
 * An empty array is treated as a failure for the same reason: a bulletin that suddenly parses
 * to zero notices is a format change, not a quiet day.
 */
export function extractNotices(message: ExtractSource, domain: string | null): ExtractedNotice[] | null {
  const extractor = extractorFor(domain);
  if (!extractor) return null;

  try {
    const notices = extractor(message);
    if (!notices || notices.length === 0) return null;
    // A notice with no identity cannot be deduped, so it would arrive again every night.
    return notices.filter((n) => n.externalRef && n.title);
  } catch (e) {
    console.error(`[tenders] extractor for ${domain} threw, falling back to generic:`, (e as Error).message);
    return null;
  }
}
