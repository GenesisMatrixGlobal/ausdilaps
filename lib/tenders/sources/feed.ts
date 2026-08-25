import { FETCH_TIMEOUT_MS } from "../config";
import { canonicalUrl, contentHash, externalRefForRss } from "../dedupe";
import { decodeEntities, htmlToText } from "@/lib/html";
import type { FetchResult, RawItem } from "../types";

/**
 * RSS / Atom adapter.
 *
 * Hand-rolled rather than pulling in an XML parser: RSS and Atom item extraction is a
 * small, well-understood shape, and the repo has no XML dependency to reuse. If a third
 * feed format ever shows up, that is the moment to add fast-xml-parser — not before.
 *
 * A descriptive User-Agent is not optional. Both tenders.gov.au and data.gov.au returned
 * 403 to an unidentified automated fetch during research, and Vercel's datacenter IPs are
 * more likely to be filtered than a laptop. Verify any new feed from a deployed preview,
 * not just localhost.
 */

const USER_AGENT =
  "AusDilapsTenderWatch/1.0 (+https://ausdilaps.com.au; tender monitoring; contact info@ausdilaps.com.au)";

/** Pulls the text of the first matching tag, unwrapping CDATA. */
function tag(block: string, ...names: string[]): string | null {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match) {
      // CDATA first, then entities: a <link> arrives as "...?a=1&amp;b=2", and treating
      // that as literal text leaves a bogus "amp;b" parameter in the canonicalised URL —
      // which then churns the dedupe key on every fetch.
      const value = decodeEntities(
        match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      ).trim();
      if (value) return value;
    }
  }
  return null;
}

/** Atom links carry the URL in an attribute rather than the element body. */
function atomLink(block: string): string | null {
  const alternate = block.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alternate) return decodeEntities(alternate[1]);
  const plain = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
  return plain ? decodeEntities(plain[1]) : null;
}

function toIso(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Best-effort agency extraction. Government feeds put the buying agency in wildly
 * different places, so this reads the common ones and otherwise leaves it null for the
 * classifier to pull out of the body — which it does more reliably than a regex would.
 */
function agencyOf(block: string): string | null {
  return tag(block, "dc:creator", "author", "agency", "category");
}

export function parseFeed(xml: string, sourceSlug: string): RawItem[] {
  const blocks = [
    ...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi),
  ].map((m) => m[1]);

  const items: RawItem[] = [];

  for (const block of blocks) {
    const title = tag(block, "title");
    if (!title) continue; // a feed entry with no title is not a tender

    const link = tag(block, "link") ?? atomLink(block);
    const guid = tag(block, "guid", "id");
    const publishedAt = toIso(tag(block, "pubDate", "published", "updated", "dc:date"));
    const body = tag(block, "description", "summary", "content", "content:encoded") ?? "";

    const cleanTitle = htmlToText(title, 300);
    const excerpt = htmlToText(body, 12_000);
    const agency = agencyOf(block);

    items.push({
      sourceSlug,
      externalRef: externalRefForRss({ guid, link, title: cleanTitle, publishedAt, agency }),
      title: cleanTitle,
      url: link ? canonicalUrl(link) : null,
      agency: agency ? htmlToText(agency, 200) : null,
      publishedAt,
      closesAt: null, // the classifier extracts this from the body far more reliably
      excerpt,
      contentHash: contentHash({ title: cleanTitle, agency, closesAt: null }),
      // A feed has no sender to verify. The URL comes from lib/tenders/sources.ts — our
      // own code, not anything a third party supplied — so the provenance question the
      // sender_trusted flag exists to answer simply does not arise here.
      senderTrusted: true,
    });
  }

  return items;
}

export async function fetchFeed(url: string, sourceSlug: string): Promise<FetchResult> {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Feed ${res.status}: ${body.slice(0, 300)}`);
  }

  const xml = await res.text();

  // The raw payload is captured whether or not parsing succeeds, and is returned even when
  // items is empty — the empty case is precisely when it matters.
  return {
    raw: { url, status: res.status, bytes: xml.length, body: xml.slice(0, 200_000) },
    items: parseFeed(xml, sourceSlug),
  };
}
