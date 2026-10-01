/**
 * Is there still time to do something about this tender?
 *
 * ── Why this replaced an ingest-date window ───────────────────────────────────────────────
 *
 * The review list used to be scoped by `created_at >= 14 days`, the same window as the
 * funnel. Measured on the live queue, that showed **5 of 48 items**: 43 were unreachable,
 * including a Seymour Whyte "Dilapidation Survey - Properties" from 2 September — exactly the
 * job the tool exists to catch. Meanwhile the morning health email said "46 untouched for
 * over 3 days" and linked to the page showing 5.
 *
 * The window was never the right question. When we happened to ingest something says nothing
 * about whether it is worth doing; its CLOSING DATE does. So:
 *
 *   - closes more than MIN_LEAD_TIME from now  → actionable, however old the row is
 *   - no closing date at all                   → actionable
 *   - closes sooner than that, or has closed   → not
 *
 * ⚠️ THE UNDATED CASE IS THE IMPORTANT ONE, not an edge case to tidy away. A direct email
 * invitation ("Muswellbrook Bypass Project - Dilapidation Survey", the Australia Avenue RFQ)
 * states no portal deadline, so `closes_at` is null — and on the live queue those 9 rows were
 * the single best thing in it. A rule that required a future date would have dropped every
 * one while keeping nothing of value: all 27 of the tracking-URL junk rows carry a date, and
 * every one of those dates has passed, so the deadline test removes them on its own.
 *
 * The funnel keeps WINDOW_DAYS. That is deliberate and is not a second window on the same
 * question: the funnel reports a fortnight's pipeline ACTIVITY, this decides what is still
 * worth a person's time. Two different questions, and the UI labels both.
 */

/**
 * How much runway an opportunity needs to be worth showing.
 *
 * Rhys, 2026-10-01: "so long as the quote is not due for at least 24 hours, we can add it in
 * 'to review'". Below that there is no realistic chance of pricing and submitting, so the row
 * is noise on the one screen that is meant to be a work queue.
 */
export const MIN_LEAD_TIME_MS = 24 * 60 * 60 * 1000;

export function isActionable(closesAt: string | null | undefined, now: number): boolean {
  if (!closesAt) return true; // no stated deadline — a live invitation, never a stale row
  const closes = new Date(closesAt).getTime();
  if (Number.isNaN(closes)) return true; // unparseable is not evidence it has closed
  return closes >= now + MIN_LEAD_TIME_MS;
}
