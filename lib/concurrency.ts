/**
 * Bounded-concurrency map — runs `fn` over `items` with at most `concurrency` in flight,
 * preserving input order in the result.
 *
 * Lifted out of lib/property-sizing/site-plan/label-vision.ts, where it was defined and
 * exported alongside the Claude vision calls. It is generic plumbing with no vision in it,
 * and road-survey enrichment needing to import it from a label-reading module was the
 * signal it belonged somewhere neutral.
 *
 * Note there is no error isolation here: one rejection rejects the whole call. Callers
 * that need per-item failure to be survivable should resolve to a result object inside
 * `fn` rather than throwing out of it.
 */
export async function runPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
