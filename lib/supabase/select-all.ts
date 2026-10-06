import type { PostgrestError } from "@supabase/supabase-js";

/** ⚠️ Must equal Supabase → API settings → Max rows. Lower that setting and the first page
 *  comes back "short", and every reader here stops after it — the silent truncation this
 *  file exists to prevent. */
const PAGE = 1000;
/** A caller that forgets `.range()` gets the same first page forever; stop instead. */
const MAX_PAGES = 100;

/**
 * Every row a select matches, paged past PostgREST's 1,000-row cap.
 *
 * ⚠️ The cap is SILENT: an unpaged select over a window that has outgrown it returns an
 * arbitrary 1,000 rows and no error, so a dashboard figure quietly becomes a sample. `page`
 * builds the query and ends in `.range(from, to)`; it MUST be ordered on something unique
 * (or end in `id`), or a row can land in two pages or in none. Same `{ data, error }` shape
 * as one select, so a caller's error handling and column fallbacks are unchanged.
 */
export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<{ data: T[] | null; error: PostgrestError | null }> {
  const rows: T[] = [];
  for (let from = 0; from < PAGE * MAX_PAGES; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { data: rows, error: null };
  }
  // An error, never a partial result — a partial result is the bug this helper is for.
  const message = `selectAll: more than ${PAGE * MAX_PAGES} rows (or a page without .range())`;
  return { data: null, error: { message, details: "", hint: "", code: "" } as PostgrestError };
}
