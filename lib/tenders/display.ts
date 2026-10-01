/**
 * Presentation rules shared by the tool's cards and the handoff email.
 *
 * Both surfaces describe the same opportunity to the same people, so a rule that lives in
 * only one of them is a rule the other will break. Each of these was a real defect found by
 * looking at both.
 */

/**
 * Hosts that are OUR mailbox, not a portal a recipient can open.
 *
 * ⚠️ Graph's `webLink` is a deep link into the `tenders@` mailbox. It is valid https with a
 * real hostname, so `safeExternalUrl()` passes it happily — and the email then offered
 * "Open the notice → outlook.office365.com" to a staff member who has no access to that
 * mailbox and would land on a sign-in page. Four of the nine opportunities in the first real
 * handoff were affected, and they were the four best ones: the Muswellbrook Bypass survey,
 * the Australia Avenue RFQ and both Felix dilapidation surveys.
 *
 * `email.felix.net` is the same class of problem from the other direction — a tracking and
 * unsubscribe host, not the RFQ.
 *
 * ⚠️ This is a DENYLIST and is therefore never the whole answer. The structural fix is that
 * `tender_items.url` only ever holds a link a recipient can follow (mailbox links belong in
 * `mailbox_url`); this is the guard that stops a row which predates that rule — or a future
 * adapter that forgets it — from reaching someone's inbox.
 */
const NOT_A_NOTICE = [
  "outlook.office365.com",
  "outlook.office.com",
  "outlook.com",
  "outlook.live.com",
  "mail.google.com",
  "email.felix.net",
];

/** The URL if a recipient could actually open it, else null — never a fabricated link. */
export function followableNoticeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  const blocked = NOT_A_NOTICE.some((h) => host === h || host.endsWith(`.${h}`));
  return blocked ? null : url;
}

/**
 * Are these two strings naming the same party?
 *
 * TenderSearch has no separate agency line, so its extractor puts one value in BOTH `agency`
 * and `contact` — which printed the identical string on two consecutive lines of every card
 * AND every email block. Compared on a normalised form because case and punctuation drift
 * between a source's two fields often enough that an exact test would let the repeat through.
 */
export function sameParty(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(a) === norm(b);
}

/**
 * The sending address, but only when replying to it would reach a person.
 *
 * ⚠️ This duplicated logic lived only in app/api/tenders/send/route.ts, so the handoff email
 * said "Invitation by email — reply to maira.barbosa@seymourwhyte.com.au" while the tool's
 * own card for the same item said just "invitation by email". Rhys asked for the address on
 * the card; sharing the rule is what stops the two surfaces disagreeing again.
 *
 * Useless for the aggregators, whose mail comes from `email@tendersearch.com.au` and
 * `no-reply@felix.net`, and actively misleading for our own staff forwarding something on:
 * "reply to kylie.c@ausdilaps.com.au" tells the reader to ring a colleague about a tender
 * she also just received.
 */
const ROBOT_SENDER = /^(no-?reply|do-?not-?reply|noreply|email|alerts?|notifications?|info|support|admin)@/i;

export function replyableSender(from: string | null | undefined): string | null {
  const value = from?.trim();
  if (!value) return null;
  if (ROBOT_SENDER.test(value)) return null;
  if (/@ausdilaps\.com\.au$/i.test(value)) return null;
  return value;
}
