/**
 * Per-sender structured extraction.
 *
 * ── Why this exists, given senders.ts deliberately has no per-portal table ────────────────
 *
 * The generic parser splits a message by its anchor links and hands every resulting item the
 * WHOLE email body as its excerpt. For a one-tender-per-email sender that is fine. For a
 * daily bulletin it is destructive: a TenderSearch bulletin of 14 notices became 14 items
 * that each carried all 14 notices, so the classifier could not name "the" tender, returned
 * an empty title, and the stored title fell back to the anchor href — a tracking URL. The
 * same bulletin was then classified 14 times at Opus rates, once per link.
 *
 * It also could not have worked: within one bulletin the "Web Document Location" URL is
 * IDENTICAL for every notice. There is no per-tender link to split on.
 *
 * Both high-volume senders, as it turns out, already label everything we need — project
 * name, location, closing date, contact, portal link. Reading labelled fields needs no model
 * at all, which is cheaper AND more accurate than asking one to infer them.
 *
 * ── How this stays compatible with domain-based discovery ─────────────────────────────────
 *
 * Discovery is unchanged and stays generic: a brand-new portal is tracked and parsed the
 * first night it emails, with no code change and no migration. An extractor is an OPTIONAL
 * quality upgrade for a domain someone has done the work on.
 *
 * Every extractor returns `null` for anything it does not recognise, and the caller falls
 * back to the generic path. So a portal that changes its format degrades to today's
 * behaviour — worse titles, shared excerpts — rather than dropping tenders on the floor.
 * That asymmetry is the whole reason the fallback is mandatory rather than nice to have.
 */

/**
 * The bit of a Graph message an extractor needs.
 *
 * Deliberately not `GraphMessage`: this is also the shape stored in
 * `tender_scan_runs.raw_payload`, which is what the fixtures are built from. One normalised
 * type means the tests exercise the real code path rather than a parallel one.
 */
export type ExtractSource = {
  from: string | null;
  subject: string | null;
  html: string;
  receivedDateTime?: string | null;
  hasAttachments?: boolean;
};

export type ExtractedNotice = {
  /**
   * A real per-tender identity — 'ts:967459', 'felix:127035'.
   *
   * This is the quiet win. Reminders for the same job previously keyed differently every
   * time because each carried a fresh tracking URL, so nothing could collapse them and the
   * grouping in group.ts had to approximate with agency + closing date.
   */
  externalRef: string;
  /** The project name as the notice states it. Never a URL. */
  title: string;
  siteLocation: string | null;
  contact: string | null;
  /** ISO date (yyyy-mm-dd) or null. Never a guess. */
  closesAt: string | null;
  /** A link a RECIPIENT can follow. Null rather than something only we can open. */
  url: string | null;
  agency: string | null;
  /** THIS notice's text, and only this notice's. The bug was that this was the whole email. */
  excerpt: string;
};

/** Returns null when the message is not the format this extractor understands. */
export type Extractor = (message: ExtractSource) => ExtractedNotice[] | null;
