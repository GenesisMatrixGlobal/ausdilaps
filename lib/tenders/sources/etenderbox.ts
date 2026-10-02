import { FETCH_TIMEOUT_MS } from "../config";
import { contentHash } from "../dedupe";
import { decodeEntities, htmlToText } from "@/lib/html";
import { stateFor } from "./extract/vendorpanel";
import type { FetchResult, RawItem } from "../types";

/**
 * eTenderBox — the council e-tendering platform (mostly VIC, some WA). No feed, no API, so
 * this is the one source that reads a web page.
 *
 * ── Why it is allowed ────────────────────────────────────────────────────────────────────
 *
 * robots.txt carries no rules at all (only a Cloudflare content-signal preamble that grants
 * and restricts nothing), the list and every tender page are public with no login, and a
 * night's crawl is ~4 list pages plus ~2 requests per tender — sequential on the shared
 * session, a few in parallel to the per-council detail pages. Contact EMAILS are hidden by
 * Cloudflare's email protection and are deliberately NOT unscrambled; names only.
 *
 * ── How it works ─────────────────────────────────────────────────────────────────────────
 *
 * The list is an ASP.NET WebForms grid. Rows carry no link: clicking one posts the page back
 * and the server answers 302 to the tender on its council's subdomain
 * (`belmont.etenderbox.com.au/ViewTender.aspx?tenderId=…`). So per page: replay each row's
 * postback with `redirect: "manual"` and read the Location, then press Next the same way.
 * The tenderId is stable across sessions, which is what makes it the dedupe key.
 *
 * ⚠️ A Location is only followed when it is an https ViewTender page on an etenderbox.com.au
 * subdomain. The redirect comes from a third party; without the check this would fetch
 * whatever URL it was told to from inside our infrastructure.
 */

const UA = "Mozilla/5.0 (compatible; AusDilapsTenderWatch/1.0; +https://ausdilaps.com.au)";
const LIST_URL = "https://etenderbox.com.au/ListCurrentTenders.aspx";
const MAX_PAGES = 10;
const DETAIL_CONCURRENCY = 4;
/** The whole crawl, so a slow night cannot eat the scan's 290 s. */
const BUDGET_MS = 90_000;

const TENDER_URL = /^https:\/\/([a-z0-9-]+)\.etenderbox\.com\.au\/ViewTender\.aspx\?tenderId=([^&]+)/i;

export type ListRow = { target: string; title: string; category: string; closing: string; customer: string };

/** Hidden ASP.NET form fields — echoed back on every postback. */
export function hiddenFields(html: string): Record<string, string> {
  return Object.fromEntries(
    [...html.matchAll(/<input type="hidden" name="([^"]+)"[^>]*value="([^"]*)"/g)].map((m) => [m[1], decodeEntities(m[2])])
  );
}

/** The grid's rows: each cell is a postback link, the first cell's target opens the tender. */
export function parseListRows(html: string): ListRow[] {
  const rows: ListRow[] = [];
  for (const tr of html.matchAll(/<tr class="data-grid-row"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/__doPostBack\(&#39;([^&]+)&#39;[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
      target: m[1],
      text: htmlToText(m[2], 300),
    }));
    if (cells.length < 4) continue;
    rows.push({ target: cells[0].target, title: cells[0].text, category: cells[1].text, closing: cells[2].text, customer: cells[3].text });
  }
  return rows;
}

export function pageOf(html: string): { page: number; of: number } | null {
  const m = /Page <b>(\d+)<\/b> of <b>(\d+)<\/b>/.exec(html);
  return m ? { page: Number(m[1]), of: Number(m[2]) } : null;
}

/** First value of each `<th>Label</th><td>value</td>` pair, plus every contact name. */
export function parseDetail(html: string): Record<string, string> & { names: string } {
  const out: Record<string, string> = {};
  const names: string[] = [];
  for (const m of html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) {
    const label = htmlToText(m[1], 80).trim();
    const value = htmlToText(m[2], 8000).trim();
    if (!label || !value) continue;
    // The platform lists its own helpdesk as a contact on every tender; that is not who to
    // submit to.
    if (label === "Name") {
      if (!/etenderbox|system support/i.test(value)) names.push(value);
    } else if (!(label in out)) out[label] = value;
  }
  return Object.assign(out, { names: [...new Set(names)].join(", ") });
}

/** `06/10/2026 05:00 PM AEDT (UTC+11:00)` → `2026-10-06`. Date only, like every source. */
export function closingDate(raw: string): string | null {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
  if (!m) return null;
  const [d, mo] = [Number(m[1]), Number(m[2])];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** First Sunday of a month, as a YYYY-MM-DD string. */
function firstSunday(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1));
  d.setUTCDate(1 + ((7 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * The zone, when it names one state. AWST is WA and ACST/ACDT is SA (or Broken Hill — a hint,
 * not proof). AEST is the useful trick: NSW, VIC, ACT and TAS are on AEDT from the first
 * Sunday of October to the first Sunday of April, so a time stated in AEST inside that window
 * is Queensland.
 */
export function zoneHint(raw: string): string {
  if (/\bAWST\b/.test(raw)) return "Perth";
  if (/\bAC[SD]T\b/.test(raw)) return "Adelaide";
  const date = closingDate(raw);
  if (/\bAEST\b/.test(raw) && date) {
    const year = Number(date.slice(0, 4));
    if (date >= firstSunday(year, 10) || date < firstSunday(year, 4)) return "Brisbane";
  }
  return "";
}

export function itemFrom(row: ListRow, url: string, detail: ReturnType<typeof parseDetail> | null): RawItem | null {
  const m = TENDER_URL.exec(url);
  if (!m) return null;
  const [, council, tenderId] = m;
  const title = detail?.Title || row.title;
  // ⚠️ "Revised Closing Date" first: an extended tender keeps its ORIGINAL date under
  // "Closing Date", so reading that one marks a live tender as closed. The list shows the
  // current date too.
  const closing = detail?.["Revised Closing Date"] || row.closing || detail?.["Closing Date"] || "";
  const location = detail?.Location || null;
  const excerpt = [
    title,
    detail?.Number ? `Reference: ${detail.Number}` : null,
    `Issued by: ${row.customer}`,
    location ? `Location: ${location}` : null,
    `Category: ${detail?.Category || row.category}`,
    detail?.["Market Approach"] ? `Approach: ${detail["Market Approach"]}` : null,
    `Closing: ${closing}`,
    detail?.Description ?? null,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    sourceSlug: "etenderbox",
    externalRef: `etb:${council.toLowerCase()}:${decodeURIComponent(tenderId)}`,
    title: htmlToText(title, 300),
    // Without `fromglobal`, which only tells the council page where "back" goes.
    url: `https://${council.toLowerCase()}.etenderbox.com.au/ViewTender.aspx?tenderId=${tenderId}`,
    agency: row.customer || null,
    jurisdiction: stateFor(row.customer, null, zoneHint(closing)),
    closesAt: closingDate(closing),
    siteLocation: location,
    contact: detail?.names || null,
    excerpt: excerpt.slice(0, 12_000),
    contentHash: contentHash({ title, agency: row.customer, closesAt: closingDate(closing) }),
    senderTrusted: true,
  };
}

export async function fetchETenderBox(): Promise<FetchResult> {
  const started = Date.now();
  const late = () => Date.now() - started > BUDGET_MS;
  let cookie = "";
  const remember = (res: Response) => {
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = [cookie, ...set.map((c) => c.split(";")[0])].filter(Boolean).join("; ");
  };
  const request = async (url: string, init: RequestInit = {}) => {
    const res = await fetch(url, {
      ...init,
      headers: { "user-agent": UA, ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    remember(res);
    return res;
  };
  const postBack = (fields: Record<string, string>, extra: Record<string, string>) =>
    request(LIST_URL, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, __EVENTTARGET: "", __EVENTARGUMENT: "", ...extra }),
    });

  const res = await request(LIST_URL);
  if (!res.ok) throw new Error(`eTenderBox list ${res.status}`);
  let html = await res.text();

  const found: { row: ListRow; url: string }[] = [];
  const pages: { page: number; rows: number }[] = [];
  for (let n = 0; n < MAX_PAGES && !late(); n++) {
    const fields = hiddenFields(html);
    const rows = parseListRows(html);
    const pos = pageOf(html);
    // A pager with nothing under it is a format change, not a quiet week — fail loudly so
    // the dashboard shows it, rather than recording a green run with no tenders.
    if (rows.length === 0 && pos) throw new Error(`eTenderBox page ${pos.page} of ${pos.of} parsed to 0 rows`);
    pages.push({ page: pos?.page ?? n + 1, rows: rows.length });

    for (const row of rows) {
      if (late()) break;
      const click = await postBack(fields, { __EVENTTARGET: row.target });
      const location = click.headers.get("location") ?? "";
      await click.body?.cancel();
      if (TENDER_URL.test(location)) found.push({ row, url: location });
    }

    if (!pos || pos.page >= pos.of) break;
    const next = Object.keys(fields).length
      ? await postBack(fields, {
          "ctl00$cphMain$rprTenders$pgvTenders$ctl01$btnNext_Pager.x": "5",
          "ctl00$cphMain$rprTenders$pgvTenders$ctl01$btnNext_Pager.y": "5",
        })
      : null;
    if (!next?.ok) break;
    html = await next.text();
    if (pageOf(html)?.page !== pos.page + 1) break; // the pager did not move; stop rather than loop
  }

  // Detail pages live on the council subdomains, outside the list's session, so these can run
  // a few at a time. A detail that fails still yields an item from its list row.
  const items: RawItem[] = [];
  let detailFailures = 0;
  for (let i = 0; i < found.length; i += DETAIL_CONCURRENCY) {
    const batch = found.slice(i, i + DETAIL_CONCURRENCY);
    const details = await Promise.all(
      batch.map(async ({ url }) => {
        if (late()) return null;
        try {
          const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
          return r.ok ? parseDetail(await r.text()) : null;
        } catch {
          return null;
        }
      })
    );
    batch.forEach(({ row, url }, k) => {
      if (!details[k]) detailFailures++;
      const item = itemFrom(row, url, details[k]);
      if (item) items.push(item);
    });
  }

  return {
    raw: { url: LIST_URL, pages, tenders: found.length, detailFailures, ms: Date.now() - started },
    items,
  };
}
