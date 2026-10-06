import { createAdminClient } from "@/lib/supabase/admin";
import { adminClientConfigured } from "@/lib/supabase/env";
import { MAX_LIST_ROWS, WINDOW_DAYS } from "@/lib/tenders/config";
import { groupItems } from "@/lib/tenders/group";

/**
 * How many tender opportunities are waiting for someone to send or dismiss them.
 *
 * ⚠️ Counts GROUPS, not rows, and uses the SAME `groupItems` the tool itself renders with.
 * The same tender arrives up to five times (portal reminders carry fresh tracking URLs), so
 * a row count would read 41 where the queue shows 12 — a tile that disagrees with the page
 * it links to is worse than no tile, because the first thing anyone does is click it.
 *
 * Same window as the tool (`WINDOW_DAYS`) for the same reason: Tender Watch deliberately
 * runs on ONE window after a spell where four different spans made no two numbers agree.
 *
 * ONE query, and the same predicate as the tool's queue — `relevance in (match, maybe)`,
 * never forwarded, never archived — which is exactly what `tender_items_actionable_idx`
 * serves.
 */

export type TenderReview = {
  /** Opportunities waiting on a person. 0 is the good answer. */
  pending: number;
  /** The soonest closing date among them, or null. What makes it urgent rather than just open. */
  closesSoonest: string | null;
  /** Of the pending ones, how many close within a week. */
  closingThisWeek: number;
  unavailable: string | null;
};

const EMPTY = (unavailable: string | null): TenderReview => ({
  pending: 0,
  closesSoonest: null,
  closingThisWeek: 0,
  unavailable,
});

export async function loadTenderReview(): Promise<TenderReview> {
  // Feature-detected like loadDashboard: an unconfigured environment must render the page
  // with a dash, never a 500. Tender Watch is one tile on a dashboard about six other things.
  if (!adminClientConfigured()) {
    return EMPTY("Supabase isn't configured in this environment.");
  }

  try {
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
    const db = createAdminClient();

    const { data, error } = await db
      .from("tender_items")
      .select("id, title, agency, closes_at, confidence, created_at")
      .in("relevance", ["match", "maybe"])
      .is("forwarded_at", null)
      .neq("status", "archived")
      .gte("created_at", since)
      .limit(MAX_LIST_ROWS);

    if (error) throw new Error(error.message);

    const groups = groupItems(data ?? []);

    // A group's closing date comes from its lead, which is the copy the tool shows.
    const closing = groups
      .map((g) => g.lead.closes_at)
      .filter((d): d is string => !!d)
      .sort();

    const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString();

    return {
      pending: groups.length,
      closesSoonest: closing[0] ?? null,
      closingThisWeek: closing.filter((d) => d <= weekOut).length,
      unavailable: null,
    };
  } catch (e) {
    const message = (e as Error).message;
    console.error("[admin] tender review count failed:", message);
    return EMPTY(`Tender Watch unavailable: ${message}`);
  }
}
