// The people behind the "Samples viewed" tile — /admin/samples.
//
// page_views rows on the samples path, grouped by the browser's visitor id (migration
// 0021) into one history each: when they first and last came, how they got in, what they
// opened. A NAME attaches only through the email unlock (lead_id) — the access code is one
// code on every quote, so a code unlock is an anonymous browser and is shown as one.

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { SAMPLES_VIEW_PATH, type PageViewEvent } from "@/lib/page-views";

export const VISITORS_WINDOW_DAYS = 90;

export type VisitorEvent = {
  at: string;
  event: PageViewEvent;
  /** The file title, on `click_item`. */
  item: string | null;
};

export type SampleVisitor = {
  id: string;
  /** From the lead the email unlock created. Null for a code unlock — nobody typed a name. */
  name: string | null;
  email: string | null;
  company: string | null;
  /**
   *   email    gave name + email on the locked page
   *   code     followed a /samples?code=… link (from a quote or an email)
   *   earlier  reached the library on a cookie set before visitor tracking began
   *   locked   only ever saw the locked page
   */
  unlock: "email" | "code" | "earlier" | "locked";
  firstSeen: string;
  lastSeen: string;
  /** Page renders (locked + library) — the same thing the tile counts. */
  views: number;
  /** Views this browser CONFIRMED it painted (migration 0023). A visitor whose views never
   *  painted did not look at anything — it fetched the page. Kept on the list rather than
   *  dropped, so the scraping stays visible, but marked. */
  paintedViews: number;
  /** Distinct files opened. */
  filesOpened: number;
  /** Where the FIRST visit came from, when the browser said. Our own pages are dropped —
   *  "came from the samples page" is not an answer. */
  referrer: string | null;
  device: string;
  /** Newest first. */
  events: VisitorEvent[];
};

export type SamplesVisitorsPage = {
  visitors: SampleVisitor[];
  /** Page views in the window with no visitor id — rows written before 0021, or from a
   *  browser that would not take the cookie. Reported, never dropped. */
  untrackedViews: number;
  unavailable: string | null;
};

type Row = {
  event: PageViewEvent;
  occurred_at: string;
  referrer: string | null;
  user_agent: string | null;
  visitor_id: string | null;
  lead_id: string | null;
  item: string | null;
  /** Migration 0023. Null on rows written before it, which is NOT the same as false —
   *  see the badge in app/admin/samples/page.tsx. */
  rendered: boolean | null;
};

const PAGE = 1000;
/** 10k rows is ~a year of real traffic at today's rate; past that the window is too wide. */
const MAX_PAGES = 10;

export async function loadSamplesVisitors(): Promise<SamplesVisitorsPage> {
  try {
    const db = createAdminClient();
    const since = new Date(Date.now() - VISITORS_WINDOW_DAYS * 86_400_000).toISOString();

    // PostgREST caps a select at 1,000 rows, so page — oldest first, so the visitor's
    // history assembles in order and "first seen" is simply the first row met.
    const rows: Row[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await db
        .from("page_views")
        .select("event, occurred_at, referrer, user_agent, visitor_id, lead_id, item, rendered")
        .eq("path", SAMPLES_VIEW_PATH)
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < PAGE) break;
    }

    const byVisitor = new Map<string, SampleVisitor & { leadIds: Set<string>; itemSet: Set<string> }>();
    let untrackedViews = 0;

    for (const r of rows) {
      const isView = r.event === "view_locked" || r.event === "view_library";
      if (!r.visitor_id) {
        if (isView) untrackedViews++;
        continue;
      }
      let v = byVisitor.get(r.visitor_id);
      if (!v) {
        v = {
          id: r.visitor_id,
          name: null,
          email: null,
          company: null,
          unlock: "locked",
          firstSeen: r.occurred_at,
          lastSeen: r.occurred_at,
          views: 0,
          paintedViews: 0,
          filesOpened: 0,
          referrer: externalReferrer(r.referrer),
          device: deviceFrom(r.user_agent),
          events: [],
          leadIds: new Set(),
          itemSet: new Set(),
        };
        byVisitor.set(r.visitor_id, v);
      }
      v.lastSeen = r.occurred_at;
      if (!v.referrer) v.referrer = externalReferrer(r.referrer);
      if (isView) {
        v.views++;
        if (r.rendered === true) v.paintedViews++;
      }
      if (r.event === "click_item" && r.item) v.itemSet.add(r.item);
      if (r.lead_id) v.leadIds.add(r.lead_id);
      v.events.push({ at: r.occurred_at, event: r.event, item: r.item });

      // Best evidence wins: a name beats a code, a code beats an inherited cookie.
      if (r.event === "unlock_email") v.unlock = "email";
      else if (r.event === "unlock_code" && v.unlock !== "email") v.unlock = "code";
      else if (r.event === "view_library" && v.unlock === "locked") v.unlock = "earlier";
    }

    // One round trip for every named visitor's lead.
    const leadIds = [...new Set([...byVisitor.values()].flatMap((v) => [...v.leadIds]))];
    const leads = new Map<string, { name: string | null; email: string | null; company: string | null }>();
    if (leadIds.length > 0) {
      const { data, error } = await db.from("leads").select("id, name, email, company").in("id", leadIds);
      if (error) throw error;
      for (const l of data ?? []) leads.set(l.id as string, l as (typeof leads extends Map<string, infer T> ? T : never));
    }

    const visitors: SampleVisitor[] = [...byVisitor.values()]
      .map(({ leadIds, itemSet, ...v }) => {
        const lead = [...leadIds].map((id) => leads.get(id)).find(Boolean);
        return {
          ...v,
          name: lead?.name ?? null,
          email: lead?.email ?? null,
          company: lead?.company ?? null,
          filesOpened: itemSet.size,
          events: v.events.reverse(),
        };
      })
      .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));

    return { visitors, untrackedViews, unavailable: null };
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    console.error("[samples-visitors] failed to load:", message);
    return {
      visitors: [],
      untrackedViews: 0,
      unavailable: /visitor_id|lead_id|'item'|schema cache/i.test(message)
        ? "Run migration 0021_samples_visitors.sql — visitor tracking needs its three columns."
        : message,
    };
  }
}

/** A referrer worth showing: some other site, or the email/quote link that brought them.
 *  Our own pages are dropped. */
function externalReferrer(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (/(^|\.)ausdilaps\.com\.au$|vercel\.app$|^localhost$/i.test(u.hostname)) return null;
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Coarse device family, from the user agent. Enough to tell "read it at their desk" from
 *  "opened it on the phone from the email"; nothing finer is wanted. */
function deviceFrom(ua: string | null): string {
  if (!ua) return "Unknown device";
  if (/iPhone|iPad/i.test(ua)) return "iPhone / iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  return "Other";
}
