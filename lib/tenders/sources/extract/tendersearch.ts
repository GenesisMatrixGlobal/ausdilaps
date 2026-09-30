import { htmlToText } from "@/lib/html";
import { canonicalUrl } from "../../dedupe";
import { parseDayMonthYear } from "./date";
import type { ExtractSource, ExtractedNotice, Extractor } from "./types";

/**
 * TenderSearch daily bulletin.
 *
 * One email carries every notice matched for us that day — 2 to 14 of them, all in one body.
 * Each is laid out with labels:
 *
 *   Texas STP pump and chlorine pre-fabricated buildings - Design, Supply…  TS #967459
 *   Closing Date:           07-Oct-2026 04:00 PM
 *   Location:               GOONDIWINDI QLD
 *   Web Document Location:  https://link.tendersearch.com.au/token/…
 *   Contact:                GovDept
 *                           Goondiwindi Regional Council
 *                           Contract No. RFT2627-19F
 *   <description>
 *   Return to Top
 *
 * ── Splitting on `TS #<digits>`, not on "Return to Top" ───────────────────────────────────
 *
 * Both look like delimiters. Checked against all five bulletins in the raw_payload archive:
 * "Return to Top" got four right and mis-split the fifth (13 blocks for 14 notices), because
 * the last notice before the footer does not always carry one. `TS #<digits>` occurred
 * exactly once per notice in all five — 47 notices in total.
 *
 * It also gives us a genuine per-tender reference for external_ref, which is what finally
 * makes duplicate reminders collapse on identity instead of on a guess.
 *
 * The bulletin opens with a table of contents listing the same project names WITHOUT their
 * TS numbers, so splitting on the number skips it for free — no heading heuristics needed.
 */

/** `TS #967459` — the per-tender reference, and the block delimiter. */
const REF = /TS\s*#\s*(\d{4,})/g;

/** A bulletin says so in its own subject; anything else is not ours to parse. */
function isBulletin(message: ExtractSource): boolean {
  return /tendersearch/i.test(message.from ?? "") && /bulletin|notification/i.test(message.subject ?? "");
}

/**
 * The value after `Label:`.
 *
 * Stops at the next label, because several labels share a line once the HTML is flattened
 * ("Closing Date: 07-Oct-2026 04:00 PM Location: GOONDIWINDI QLD Web Document Location:").
 * It also has to stop at `Contract No.` and the `VP…` reference, which are NOT labelled
 * fields but do follow the contact — without them the contact swallowed the contract number
 * and then ran on into the description.
 */
const NEXT_FIELD = "Closing Date|Location|Web Document Location|Contact|Contract No|VP\\s*(?:Reference)?\\s*#?\\d";

function labelled(block: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*:?\\s*([\\s\\S]*?)(?=\\n?\\s*(?:${NEXT_FIELD})\\b\\s*:?|$)`, "i");
  const m = re.exec(block);
  const value = m?.[1]?.replace(/\s+/g, " ").trim();
  return value ? value : null;
}

/**
 * TenderSearch's own placeholders for "no location given".
 *
 * Storing these would put the words "not stated" in front of someone as if they were an
 * address, which is worse than an empty field.
 */
function realLocation(value: string | null): string | null {
  if (!value) return null;
  return /^(not stated|as stated|various|n\/?a)\b/i.test(value) ? null : value;
}

/**
 * `Contact: GovDept / Goondiwindi Regional Council` — the first token is the contact TYPE,
 * the rest is who it actually is. "Enquiries" appears the same way on some notices.
 *
 * ⚠️ The type token is not always FIRST, which is what let a mangled string reach the queue:
 * Wellington Shire arrived as `/Technical GovDept Wellington Shire Council Ph: 1800 377 628`,
 * where a department ("/Technical") sits in front of GovDept, so the old `^`-anchored strip
 * matched nothing and the whole lot — slash, marker and switchboard number — was printed on
 * the card as both the agency AND the contact.
 *
 * The phone goes too. A number glued to the end of an organisation name is not a contact
 * detail anyone can act on from a card, and the notice's own excerpt still carries it.
 */
export function cleanContactValue(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    // ⚠️ ANCHOR ON THE MARKER, not on the start of the string. The contact TYPE is whatever
    // sits in front of it — "Technical", "Documents", "/Technical" — and a ^-anchored strip
    // caught only the cases where the marker happened to come first. Everything before it is
    // the type; everything after is who it actually is.
    .replace(/^.*?\b(?:GovDept|Government Department)\b\s*/i, "")
    .replace(/^(?:Enquiries)\s*/i, "")
    // A trailing switchboard or mobile number. Not something anyone can act on from a card,
    // and the notice's own excerpt still carries it. An EMAIL is kept — that one is usable.
    .replace(/\s*\b(?:Ph|Phone|Tel|Mob|Mobile)\.?:?\s*[\d ()+-]{6,}\s*$/i, "")
    .replace(/^[\s/·-]+/, "")
    .trim();
  return cleaned || null;
}


export const extractTenderSearch: Extractor = (message: ExtractSource) => {
  if (!isBulletin(message)) return null;

  // The whole bulletin as text once, then sliced. htmlToText already strips script/style and
  // turns block ends into newlines, which is what makes the labels land on their own lines.
  const text = htmlToText(message.html, 200_000);

  const marks = [...text.matchAll(REF)];
  if (marks.length === 0) return null; // not the format we think it is — fall back

  const notices: ExtractedNotice[] = [];

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    const refNumber = mark[1];

    // The project name sits immediately BEFORE the reference. Walk back to the previous
    // notice's end (or the start) and take the last non-empty line — the line above is the
    // procurement category ("Architectural Consultancies"), which is not the project.
    const prevEnd = i === 0 ? 0 : (marks[i - 1].index ?? 0);
    const before = text.slice(prevEnd, mark.index ?? 0);
    const beforeLines = before
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const title = beforeLines[beforeLines.length - 1] ?? "";

    // The body runs to the next reference, trimmed at "Return to Top" where present so the
    // footer and the next category heading stay out of this notice's excerpt.
    const nextStart = i + 1 < marks.length ? (marks[i + 1].index ?? text.length) : text.length;
    let block = text.slice((mark.index ?? 0) + mark[0].length, nextStart);
    const returnToTop = block.search(/Return to Top/i);
    if (returnToTop !== -1) block = block.slice(0, returnToTop);

    // ⚠️ The link is taken from THIS NOTICE'S BLOCK, never once for the bulletin.
    //
    // This was wrong when the extractor shipped. The comment here used to claim every "Web
    // Document Location" in a bulletin carried the same subscriber token, so one was found
    // and shared — that was read off a two-notice bulletin and is simply false. The 28-Sep
    // bulletin has 10 notices and 10 DISTINCT tokens, so nine of its ten items linked to
    // somebody else's tender. Reported from the queue: the Wellington Shire item opened the
    // wrong notice.
    const noticeUrl = /https?:\/\/link\.tendersearch\.com\.au\/[^\s"'<>]+/i.exec(block)?.[0] ?? null;

    const closesRaw = labelled(block, "Closing Date");
    const location = realLocation(labelled(block, "Location"));
    const contact = cleanContactValue(labelled(block, "Contact"));

    notices.push({
      externalRef: `ts:${refNumber}`,
      title: title || `TenderSearch ${refNumber}`,
      siteLocation: location,
      contact,
      closesAt: closesRaw ? parseDayMonthYear(closesRaw) : null,
      url: noticeUrl ? canonicalUrl(noticeUrl) : null,
      // ⚠️ The SAME string, deliberately: TenderSearch names the buying body under "Contact:"
      // and gives no separate agency line, so this is the best value for both. The card must
      // therefore print it ONCE — see GroupCard, which drops the contact line when it repeats
      // the agency. Do not "fix" the duplication here by blanking one of them; the handoff
      // email and the Salesforce match both read agency, and the tool reads contact.
      agency: contact,
      excerpt: `${title}\n\n${block}`.replace(/\n{3,}/g, "\n\n").trim().slice(0, 6_000),
    });
  }

  return notices;
};
