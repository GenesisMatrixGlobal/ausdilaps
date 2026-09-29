import { htmlToText } from "@/lib/html";
import { canonicalUrl } from "../../dedupe";
import { parseDayMonthYear } from "./date";
import type { ExtractSource, ExtractedNotice, Extractor } from "./types";

/**
 * Buying for Victoria — "New Tender Notifications".
 *
 * ── Why this exists rather than a crawl of tenders.vic.gov.au/tenders/open ────────────────
 *
 * That page was asked for and CANNOT be fetched: it sits behind Cloudflare bot protection
 * and answers 403 with a challenge page ("Sorry, you have been blocked"), and the site's
 * robots.txt disallows /tender/view — the very detail pages a crawl would need. Getting past
 * either is not something to do to a government procurement site.
 *
 * The email alert is the sanctioned route to the same tenders, and it was ALREADY arriving —
 * it just parsed badly. The generic parser took the reference code as the title, so the queue
 * showed rows called "T2026-0816" and "ATNPP10059875KTHO" with no project name, no agency and
 * no closing date, and every one of them read as no_match.
 *
 * ── The shape ────────────────────────────────────────────────────────────────────────────
 *
 * A real HTML table, one <tr> per tender with exactly three cells:
 *
 *   ATN2026-03 │ Provision of Air Conditioning and Mechanical Maintenance Services │ 19 Oct 2026, 11:00 am
 *              │ Fire Rescue Victoria                                              │
 *              │ 72151200 - Heating and cooling and air conditioning HVAC …        │
 *
 * So the cells are parsed, not the flattened text — the layout is unambiguous here and
 * reading it directly avoids the line-counting the other two extractors have to do.
 *
 * ⚠️ THE EMAIL IS TRUNCATED. It carries the first few matches and then a row reading
 * "View 120+ more matching tenders". Those are NOT in the message and cannot be recovered
 * from it — the only ways to them are the portal (blocked) or narrower saved searches in the
 * Buying for Victoria account, so that the daily alert fits. Worth knowing before trusting
 * this source to be complete: it is a sample, not the set.
 */

/** `tender/view?id=334821` — Victoria's own id, and a far better key than the display code. */
const VIEW_ID = /tenders\.vic\.gov\.au\/tender\/view\?id=(\d+)/i;

/** UNSPSC classification lines: eight digits, a dash, a description. Never the agency. */
const UNSPSC = /^\d{6,8}\s*-\s/;

function cellsOf(row: string): string[] {
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
}

const plain = (html: string) => htmlToText(html, 4_000).replace(/\s+/g, " ").trim();

export const extractBuyingForVictoria: Extractor = (message: ExtractSource) => {
  if (!/tenders\.vic\.gov\.au/i.test(message.from ?? "")) return null;
  // The alert names its own columns. Anything else from this sender is not a tender list.
  if (!/Tender Code/i.test(message.html)) return null;

  const notices: ExtractedNotice[] = [];

  for (const [, row] of message.html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = cellsOf(row);
    if (cells.length < 3) continue; // the header, and the "View 120+ more" footer row

    const code = plain(cells[0]);
    // A row whose first cell is not a reference code is furniture, not a tender.
    if (!code || code.length > 40 || /tender code/i.test(code)) continue;

    // The details cell stacks: project name, then the buying agency, then UNSPSC categories.
    const detailLines = htmlToText(cells[1], 4_000)
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (detailLines.length === 0) continue;

    const title = detailLines[0];
    // The first line after the title that is NOT a classification code. Victoria puts long
    // department names here ("Department of Families, Fairness and Housing - Homes Victoria
    // & Director of Housing"), so it is taken whole rather than split on punctuation.
    const agency = detailLines.slice(1).find((l) => !UNSPSC.test(l)) ?? null;

    const closesRaw = plain(cells[2]);
    const viewId = VIEW_ID.exec(row)?.[1] ?? null;
    const link = /href="([^"]*tenders\.vic\.gov\.au\/tender\/view[^"]*)"/i.exec(row)?.[1] ?? null;

    notices.push({
      // Victoria's own record id where the row carries a link, else the display code. Both
      // are stable per tender, so a re-sent alert collapses on the unique index instead of
      // arriving again — which is the whole reason the reference matters.
      externalRef: viewId ? `vic:${viewId}` : `vic:${code}`,
      title: title.slice(0, 300),
      // The alert states no site address — only the buying department. The classifier's
      // `location` field reads one out of the title where there is one ("4 Philip Street",
      // "26 Rankin Rd, Hastings"), which is more than a regex here would get right.
      siteLocation: null,
      contact: agency,
      closesAt: closesRaw ? parseDayMonthYear(closesRaw) : null,
      url: link ? canonicalUrl(link.replace(/&amp;/g, "&")) : null,
      agency,
      excerpt: [code, title, agency, ...detailLines.slice(1)].filter(Boolean).join("\n").slice(0, 6_000),
    });
  }

  return notices;
};
