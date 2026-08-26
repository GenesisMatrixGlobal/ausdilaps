/**
 * Heading slugs — the contract between what gets rendered and what gets linked to.
 *
 * Two places must agree, exactly, or deep links silently land on nothing:
 *
 *   components/marketing/markdown.tsx  puts these on <h2>/<h3> as `id`
 *   lib/knowledge/chunk.ts             stores them as a chunk's `anchor`
 *
 * They agree by importing the same function rather than by both being careful. That is
 * the entire reason this file exists — before it, the renderer emitted no ids at all and
 * a citation to "#step-2-check-the-neighbours" went to the top of the page.
 *
 * Deliberately NOT github-slugger-compatible: it turns "Step 2 — Check" into
 * "step-2--check" (a hyphen for each space around the removed dash), and nothing else in
 * this codebase consumes these ids, so the tidier collapse wins. If a real MDX pipeline
 * with rehype-slug is ever adopted, this function is the one place to reconcile.
 */

/** Stateless slug. Use the slugger below when a document may repeat a heading. */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, "")               // markdown emphasis markers
    .replace(/[^\p{L}\p{N}\s-]/gu, "")    // punctuation, em-dashes, emoji
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/**
 * Per-document slugger that disambiguates repeats: a second "Common problems" becomes
 * `common-problems-1`.
 *
 * Both callers must feed it EVERY heading in document order — including `#`, which the
 * chunker doesn't split on — or the counters drift apart and the ids stop matching.
 */
export function createHeadingSlugger() {
  const seen = new Map<string, number>();
  return (text: string): string => {
    const base = headingSlug(text) || "section";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}
