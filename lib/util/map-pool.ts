/**
 * Runs `fn` over `items` with at most `limit` in flight at once — keeps us polite to
 * free/rate-limited endpoints. Results come back in INPUT order, whatever order they finish in.
 *
 * No error isolation: one rejection rejects the whole call. A caller that needs one item's
 * failure to be survivable should resolve to a result object inside `fn` rather than throw.
 */
export async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
