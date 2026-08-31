/**
 * Which sender belongs to which source, and whose mail we treat as genuine.
 *
 * Separate from sources.ts only to break an import cycle: sources.ts builds its SOURCES
 * entries from this table, and sources/mailbox.ts needs the same table to route messages.
 * Both import from here; neither imports from the other.
 *
 * ONE MAILBOX, MANY SOURCES. tenders@ausdilaps.com.au receives everything, and each source
 * claims the senders it owns so that "buy.nsw has produced nothing for 5 runs" remains a
 * question the health check can answer. A single lumped source would make that
 * unanswerable, which is the whole point of tracking sources separately.
 */

export type MailboxParse = "digest" | "single";

export type MailboxSource = {
  slug: string;
  label: string;
  /**
   * Domains this source owns. Matched on the sender's domain, suffix-aware, so
   * "buy.nsw.gov.au" also claims "mail.buy.nsw.gov.au".
   *
   * ⚠️ These are best-effort guesses at what each portal actually sends from, and MUST be
   * checked against real mail. A wrong domain here is not a crash — the mail simply routes
   * to direct-invite instead, which is exactly why the catch-all exists.
   */
  senders: string[];
  /**
   * digest — one email lists many tenders; emit one item per matching link.
   * single — one email is one opportunity.
   *
   * Getting this wrong on a digest collapses thirty tenders into one row and the other
   * twenty-nine are never seen.
   */
  parse: MailboxParse;
  /** Which links in a digest are tenders rather than footer/unsubscribe noise. */
  linkPattern?: RegExp;
};

/**
 * The catch-all. Anything from a sender no named source claims lands here.
 *
 * This is the most important entry in the file. New portals get registered for alerts all
 * the time, and without a catch-all the first email from one would be silently dropped
 * because nobody had added it to this table yet. Instead it arrives, gets classified, and
 * shows up tonight — badged as a direct invite. Promoting it to its own source later is
 * one entry here, and existing rows keep working because the dedupe key doesn't change.
 */
export const CATCH_ALL_SLUG = "direct-invite";

export const MAILBOX_SOURCES: MailboxSource[] = [
  {
    slug: "buynsw-digest",
    label: "buy.nsw — daily digest email",
    senders: ["buy.nsw.gov.au", "nswbuy.nsw.gov.au"],
    parse: "digest",
    linkPattern: /buy\.nsw\.gov\.au\/.*(opportunit|tender|rft|eoi)/i,
  },
  {
    slug: "qtenders-alert",
    label: "QTenders — alert email",
    senders: ["qtenders.hpw.qld.gov.au", "hpw.qld.gov.au", "qtenders.qld.gov.au"],
    parse: "digest",
    linkPattern: /qtenders\.[a-z.]*qld\.gov\.au\/.*(tender|display|show)/i,
  },
  {
    slug: "tendersearch",
    label: "TenderSearch — aggregator alerts",
    senders: ["tendersearch.com.au"],
    parse: "digest",
    linkPattern: /tendersearch\.com\.au\/.*(tender|notice|view)/i,
  },
  {
    slug: CATCH_ALL_SLUG,
    label: "Direct invitations & unrecognised senders",
    senders: [],
    parse: "single",
  },
];

/** The domain part of "Name <a@b.com>" or "a@b.com", lowercased. */
export function senderDomain(from: string | null | undefined): string | null {
  if (!from) return null;
  const address = from.includes("<") ? from.slice(from.lastIndexOf("<") + 1) : from;
  const domain = address.replace(/>$/, "").trim().toLowerCase().split("@").pop();
  return domain || null;
}

function claims(source: MailboxSource, domain: string): boolean {
  return source.senders.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Which source owns this sender. Never returns null — an unclaimed sender is a direct
 * invite, not a dropped message.
 */
export function routeSender(from: string | null | undefined): MailboxSource {
  const domain = senderDomain(from);
  const named = domain ? MAILBOX_SOURCES.find((s) => s.senders.length > 0 && claims(s, domain)) : undefined;
  return named ?? MAILBOX_SOURCES.find((s) => s.slug === CATCH_ALL_SLUG)!;
}

/**
 * Sender domains whose mail we treat as coming from the portal it claims to be.
 *
 * Trust is a signal, never a gate: an unverified sender is still stored and still
 * classified, it is just badged in the UI and — until TENDER_FORWARD_UNTRUSTED is turned
 * on — kept out of the digest. Anyone on the internet can email the monitored inbox, so
 * this distinction has to exist somewhere.
 *
 * Defaults to every domain named in MAILBOX_SOURCES, so registering a new portal doesn't
 * also require remembering to extend an env var. TENDER_TRUSTED_SENDER_DOMAINS adds to
 * that list rather than replacing it.
 */
export function trustedSenderDomains(): string[] {
  const fromEnv = (process.env.TENDER_TRUSTED_SENDER_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...MAILBOX_SOURCES.flatMap((s) => s.senders), ...fromEnv])];
}

export function isTrustedSender(from: string | null | undefined): boolean {
  const domain = senderDomain(from);
  if (!domain) return false;
  return trustedSenderDomains().some((d) => domain === d || domain.endsWith(`.${d}`));
}
