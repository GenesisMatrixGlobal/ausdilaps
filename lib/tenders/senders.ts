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

/** URLs that are never a tender, however the digest is laid out. */
const NOISE_URL =
  /(unsubscribe|preferences|mysearchresults|\/faqs?\b|\/browse\b|privacy|twitter\.com|linkedin\.com|facebook\.com|x\.com|youtube\.com|\.(png|jpg|gif|svg|css|js)(\?|$))/i;

/**
 * Anchor text that means navigation, not a tender.
 *
 * This is the load-bearing filter, not the URL one. Felix routes every link through
 * `email.felix.net/f/a/<opaque>/<opaque>` — the tender and the help centre are
 * indistinguishable by URL, and only the visible text separates them. tenders.vic.gov.au
 * needs it too: "View more matching tenders" points at a real /tender/ path.
 */
const NOISE_TEXT: RegExp[] = [
  /^(un)?subscribe/i,
  /manage.*(preference|subscription|alert)/i,
  /^(help|support|contact|home|privacy|terms|faqs?)\b/i,
  /help\s*cent(er|re)/i,
  /^(log|sign)\s*(in|out|up)/i,
  /^(click|read|learn|see|view)\s+(here|more|all)\b/i,
  /\b(view|see)\b.*\bmore\b.*\btenders?\b/i,
  /^\d+\+?\s*more\b/i,
];

/**
 * A tender title is longer than this. "Felix" (5) is a logo link; "DIT059252" (9) is a
 * real tender reference, so the bar has to sit between them.
 */
const MIN_TITLE_CHARS = 8;

export type DigestLink = { href: string; text: string };

/** Crude tag strip — enough to judge anchor text, without pulling in the HTML sanitiser. */
function anchorText(inner: string): string {
  return inner.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

/**
 * The links in a digest that each point at one tender.
 *
 * Filters on the anchor TEXT as well as the URL, because for at least one real portal the
 * URL carries no signal at all. Returns the text too — it is the tender's title, which is
 * what the parser wants anyway, so extracting it twice would be wasted work and a chance
 * for the two passes to disagree.
 */
export function contentLinks(html: string, domain: string | null): DigestLink[] {
  const anchors = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];

  const kept: DigestLink[] = [];
  const seen = new Set<string>();

  for (const [, href, inner] of anchors) {
    if (!/^https?:\/\//i.test(href)) continue; // mailto:, tel:, anchors
    if (NOISE_URL.test(href)) continue;

    const text = anchorText(inner);
    if (text.length < MIN_TITLE_CHARS) continue;
    if (NOISE_TEXT.some((r) => r.test(text))) continue;

    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) continue; // bare homepage — a signature, not a tender

    // Dedupe on the URL: a digest often links the same tender from both a title and a
    // "read more", and two rows for one tender is exactly what external_ref prevents.
    if (seen.has(href)) continue;
    seen.add(href);
    kept.push({ href, text });
  }

  return kept;
}

/**
 * Does this message carry many tenders, or one?
 *
 * DIGEST BY DEFAULT. One qualifying link is enough — there is no "at least two" threshold,
 * because the two mistakes are not symmetrical:
 *
 *   digest read as single  →  its tenders are never itemised, never deep-linked, and the
 *                             loss is silent: no error, no empty result, just a row titled
 *                             "New Tender Notifications" where five tenders should be.
 *   single read as digest  →  one item titled by its link instead of its subject.
 *
 * The first is unrecoverable without someone noticing; the second is cosmetic and visible.
 * A real VIC notification carrying exactly one tender proved the point — under a
 * two-link threshold it collapsed into an untitled summary.
 *
 * Zero qualifying links still falls back to one whole-message item (see parseDigest), so a
 * genuine one-to-one invitation with no links is unaffected. Where the default is wrong for
 * a particular sender, pin tender_sources.parse_mode to 'single' and it stops guessing.
 */
export function detectParseMode(html: string, domain: string | null): Exclude<ParseMode, "auto"> {
  return contentLinks(html, domain).length >= 1 ? "digest" : "single";
}

/** Resolves a stored parse_mode, falling back to detection when it is 'auto'. */
export function resolveParseMode(
  stored: ParseMode,
  html: string,
  domain: string | null
): Exclude<ParseMode, "auto"> {
  return stored === "auto" ? detectParseMode(html, domain) : stored;
}
