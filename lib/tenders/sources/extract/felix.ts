import { htmlToText } from "@/lib/html";
import { canonicalUrl } from "../../dedupe";
import { parseDayMonthYear } from "./date";
import type { ExtractSource, ExtractedNotice, Extractor } from "./types";

/**
 * Felix — the RFQ portal Tier-1 contractors invite us through.
 *
 * ONE request per email, never a digest. The generic parser treated it as one anyway, purely
 * because the body contains several links ("Respond to Request", "decline here", the help
 * centre, the logo), so a single RFQ became several items that each carried the whole email.
 * That is most of why eight rows existed for four real requests.
 *
 * Four message shapes, all seen in the archive:
 *
 *   "you've got a new request for quotation from <project>"   Title / RFQ Owner / Location / Closing on
 *   "Reminder: <client> is still waiting for your response"   Title / From / Location / Closing on
 *   "Your last chance to respond to request #124667"          no labels; the body names it in prose
 *   "Guest user RFQ access for <project>"                     an access notice, not an opportunity
 *
 * The first three all carry the request number, which becomes the external_ref — so the two
 * identical reminders for #126379 now collapse on the unique index instead of arriving as two
 * more opportunities. That is the duplicate problem fixed at the source rather than grouped
 * around at read time.
 *
 * The fourth returns null and takes the generic path, because it genuinely is not a tender:
 * it announces that a colleague was granted guest access. Better it arrives as a weak item a
 * human dismisses than be silently swallowed by a parser making that judgement.
 */

/**
 * Stops a value running on into whatever label follows it once the HTML is flattened.
 *
 * `Title` has to be in here even though it is also a label we read: the reminder variant puts
 * everything on one line ("...request from Seymour Whyte. Title 126379 - … From Seymour Whyte
 * Location LIVERPOOL, NSW…"), so without it the client name swallowed the title after it.
 */
const NEXT =
  "Title|RFQ Owner|Location|Closing on|From\\b|Login now|View the request|View Request|Guest users|What does this mean|Please don";

/**
 * @param anchored require the label to start a line.
 *
 * Load-bearing for `From`, which is an English word before it is a label. Unanchored it
 * matched inside "You've received the following request from Seymour Whyte" and inside
 * "…Dilipidation Report from Fulton Hogan is due the next business day", capturing a sentence
 * fragment as the client name. Anchoring it means only the real `From` row matches.
 */
function labelled(text: string, label: string, anchored = false): string | null {
  const head = anchored ? `(?:^|\\n)\\s*${label}` : label;
  const re = new RegExp(`${head}\\s*:?\\s*\\n?\\s*([\\s\\S]*?)(?=\\n?\\s*(?:${NEXT})|$)`, "i");
  const value = re.exec(text)?.[1]?.replace(/\s+/g, " ").trim();
  return value ? value : null;
}

/** Trailing sentence punctuation and Felix's own project id are not part of a client name. */
function cleanAgency(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/^\d+\s*-\s*/, "")
    .replace(/[.,;:\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 200) : null;
}

/**
 * The request number: `#126379` in the subject, or the `126379 - ` prefix on the Title.
 *
 * Without one there is no stable identity for the request, so the extractor declines rather
 * than inventing a key that would let the same RFQ in twice tomorrow.
 */
function requestNumber(message: ExtractSource, text: string): string | null {
  return (
    /request\s*#\s*(\d{4,})/i.exec(message.subject ?? "")?.[1] ??
    /request\s*#\s*(\d{4,})/i.exec(text)?.[1] ??
    /\bTitle\s*:?\s*\n?\s*(\d{4,})\s*-\s/i.exec(text)?.[1] ??
    null
  );
}

/**
 * The link a recipient should follow.
 *
 * Chosen by ANCHOR TEXT, not position: every href is an `email.felix.net/f/a/<opaque>`
 * tracking redirect, so the URL itself says nothing about where it goes. The same reason
 * senders.ts filters digests on anchor text rather than URL.
 */
function actionLink(html: string): string | null {
  const anchors = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const [, href, inner] of anchors) {
    const label = inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (!/^https?:\/\//i.test(href)) continue;
    if (/respond to request|view (the )?request|view rfq|submit your response/i.test(label)) {
      return canonicalUrl(href);
    }
  }
  return null;
}

export const extractFelix: Extractor = (message: ExtractSource) => {
  if (!/felix\.net/i.test(message.from ?? "")) return null;

  const text = htmlToText(message.html, 40_000);
  const number = requestNumber(message, text);
  if (!number) return null; // guest-user access notices and anything unrecognised

  // "Title \n 126379 - Dilapidation Survey - Properties". The prose variant has no label, so
  // fall back to what the sentence names: "request #124667 Dilipidation Report from Fulton
  // Hogan is due..." — the scope sits between the number and " from ".
  const titled = labelled(text, "Title");
  const prose = new RegExp(`request\\s*#\\s*${number}\\s+([\\s\\S]{3,120}?)\\s+from\\s+`, "i").exec(text)?.[1];
  const title = (titled ?? (prose ? `${number} - ${prose.replace(/\s+/g, " ").trim()}` : null)) ?? `Felix request ${number}`;

  // The client. Four shapes, most specific first, because Felix names it differently in
  // every message type and only one of them uses a label:
  //
  //   new RFQ       "request for quotation from 69207 - New Richmond Bridge Stage 2 Project."
  //   reminder      subject: "Reminder: Seymour Whyte is still waiting for your response"
  //                 body:    "…the following request from Seymour Whyte." and an inline `From`
  //   last chance   "…Dilipidation Report from Fulton Hogan is due the next business day"
  //
  // The reminder's `From` row is mid-line rather than starting one, so the anchored label
  // does not reach it — the subject is both more reliable and cheaper there.
  const agency =
    cleanAgency(labelled(text, "From", true)) ??
    cleanAgency(/^Reminder:\s*([^.\n]{3,80}?)\s+is still waiting/i.exec(message.subject ?? "")?.[1]) ??
    cleanAgency(/request for quotation from\s+([^.\n]{3,120}?)\s*(?:\.|\bHere\b)/i.exec(text)?.[1]) ??
    cleanAgency(/\b(?:following )?request from\s+([^.\n]{3,80}?)\s*\./i.exec(text)?.[1]) ??
    cleanAgency(/\bfrom\s+([^.\n]{3,80}?)\s+is due\b/i.exec(text)?.[1]);

  const closing = labelled(text, "Closing on");
  const location = labelled(text, "Location");

  return [
    {
      externalRef: `felix:${number}`,
      title: title.slice(0, 300),
      siteLocation: location?.slice(0, 200) ?? null,
      // "RFQ Owner" is a named person — the best submission contact any source gives us.
      // The sending address is no-reply@felix.net, so there is deliberately no fallback to it.
      contact: labelled(text, "RFQ Owner"),
      closesAt: closing ? parseDayMonthYear(closing) : null,
      url: actionLink(message.html),
      agency,
      excerpt: text.slice(0, 6_000),
    } satisfies ExtractedNotice,
  ];
};
