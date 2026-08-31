/**
 * Sender domains, and deciding what a message is.
 *
 * There used to be a hardcoded table here listing buy.nsw, QTenders and TenderSearch, with
 * a catch-all for everything else. That is gone: the domain IS the source, discovered from
 * the mailbox (see sources/mailbox.ts). Portals get signed up for ad hoc and this file
 * should not need editing when one is.
 *
 * What remains is the two judgements that cannot come from a database row: what the
 * sender's domain is, and whether a given email carries one tender or thirty.
 */

export type ParseMode = "auto" | "digest" | "single";

/** Slugs are `email:<domain>` so they are readable in tender_items.source_slug. */
export const EMAIL_SLUG_PREFIX = "email:";

export function slugForDomain(domain: string): string {
  return `${EMAIL_SLUG_PREFIX}${domain.toLowerCase()}`;
}

/** The domain part of `Name <a@b.com>` or `a@b.com`, lowercased. */
export function senderDomain(from: string | null | undefined): string | null {
  if (!from) return null;
  const address = from.includes("<") ? from.slice(from.lastIndexOf("<") + 1) : from;
  const domain = address.replace(/>$/, "").trim().toLowerCase().split("@").pop();
  if (!domain) return null;
  // A display name with no address at all shouldn't become a source called "no-reply".
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null;
}

/** Domains seeded as trusted at discovery, so known-good portals don't need a toggle. */
export function seedTrustedDomains(): string[] {
  return (process.env.TENDER_TRUSTED_SENDER_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function isSeededTrusted(domain: string): boolean {
  return seedTrustedDomains().some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** Links that are never a tender, however the digest is laid out. */
const NOISE = /(unsubscribe|preferences|privacy|twitter\.com|linkedin\.com|facebook\.com|x\.com|youtube\.com|\.(png|jpg|gif|svg|css|js)(\?|$))/i;

/** Paths that look like a specific thing rather than a landing page. */
const CONTENT_PATH = /\/(tender|opportunit|notice|rft|rfq|rfp|eoi|atm|display|view|show|detail|job|project|contract)/i;

/**
 * Links in a digest that plausibly point at one tender each.
 *
 * Exported because parse-mode detection and digest parsing must agree on what counts —
 * detecting "digest" on links the parser then rejects would produce the zero-link
 * fallback every time, which looks like a broken portal rather than a bad heuristic.
 */
export function contentLinks(html: string, domain: string | null): string[] {
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);

  const kept = hrefs.filter((href) => {
    if (!/^https?:\/\//i.test(href)) return false; // mailto:, tel:, anchors
    if (NOISE.test(href)) return false;
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return false;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return false; // bare homepage — a signature, not a tender

    const sameDomain = domain ? url.hostname.toLowerCase().endsWith(domain) : false;
    // Either it is on the portal's own domain with a real path, or it looks like a tender
    // link wherever it is hosted — aggregators link straight out to the source portal.
    return (sameDomain && segments.length >= 2) || CONTENT_PATH.test(url.pathname);
  });

  return [...new Set(kept)];
}

/**
 * Does this message carry many tenders, or one?
 *
 * DELIBERATELY BIASED TOWARD DIGEST. The two mistakes are not symmetrical:
 *
 *   digest read as single  →  29 of 30 tenders silently lost, no error, no empty result
 *   single read as digest  →  a couple of junk items the classifier rejects
 *
 * Two content links is enough, and the miss is self-correcting: a single invitation
 * wrongly called a digest finds no content links at parse time and falls back to one
 * whole-message item (see parseDigest). So the only way to lose a tender here is to guess
 * "single" on something that wasn't, which is the case this threshold is set low to avoid.
 */
export function detectParseMode(html: string, domain: string | null): Exclude<ParseMode, "auto"> {
  return contentLinks(html, domain).length >= 2 ? "digest" : "single";
}

/** Resolves a stored parse_mode, falling back to detection when it is 'auto'. */
export function resolveParseMode(
  stored: ParseMode,
  html: string,
  domain: string | null
): Exclude<ParseMode, "auto"> {
  return stored === "auto" ? detectParseMode(html, domain) : stored;
}
