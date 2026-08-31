import { createHash } from "node:crypto";

/**
 * Deriving the idempotency key.
 *
 * The contract for `external_ref`: stable across re-publication of the SAME tender, unique
 * within a source, prefixed with how it was derived, and never built from a field the
 * publisher edits during a tender's life (closing date, status, amendment number) — nor
 * from anything the model produced.
 *
 * Getting this wrong is loud in one direction and silent in the other: too volatile and
 * the team gets the same tender re-emailed nightly; too loose and a genuinely new tender
 * is swallowed. The prefixes exist so that improving an extractor creates NEW rows rather
 * than colliding with rows keyed under the old scheme.
 */

const sha = (input: string, len = 32) =>
  createHash("sha256").update(input, "utf8").digest("hex").slice(0, len);

/**
 * NFKC + trim + collapse whitespace. Deliberately does NOT lowercase — portal reference
 * IDs are opaque and can be case-significant.
 */
function normalise(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * Drops tracking and session parameters that churn on every fetch. Without this, a feed
 * that appends a fresh utm_ or session id per request produces a brand-new "tender" every
 * single night.
 */
export function canonicalUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|_ga|fbclid|gclid|mc_|sessionid|jsessionid|phpsessid)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return raw.trim();
  }
}

/**
 * Portal reference ids, in a path or a query param: `PR10041882`, `ATM-1234`,
 * `RFT-2026-001`, `RFQ-2026-4471-12`.
 *
 * The trailing `(?:[-_]\d+)*` is load-bearing, not tidiness. Without it the pattern
 * stopped at the first number group, so buy.nsw's `RFT-2026-001` and `RFT-2026-002` both
 * reduced to `RFT2026` — two unrelated tenders sharing one idempotency key, the second
 * silently swallowed as a duplicate of the first. Exactly the "too loose" failure the note
 * at the top of this file warns about, and the silent direction of it.
 *
 * AusTender's own ids carry no inner separator, so they are unaffected either way.
 */
function atmId(...candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = candidate.match(/\b((?:PR|ATM|RFT|RFQ|EOI)[-_]?\d{4,}(?:[-_]\d+)*)\b/i);
    if (match) return match[1].toUpperCase().replace(/[-_]/g, "");
  }
  return null;
}

/**
 * Resolution order matters. AusTender re-publishes an amended tender under a NEW guid but
 * the SAME ATM id, so keying on the id gives an UPDATE (refreshing the closing date on the
 * existing row) rather than a second alert for a tender the team already saw.
 */
export function externalRefForRss(item: {
  guid?: string | null;
  link?: string | null;
  title: string;
  publishedAt?: string | null;
  agency?: string | null;
}): string {
  const id = atmId(item.guid, item.link);
  if (id) return `atm:${id}`;

  // Hashed rather than stored raw so a pathological 4KB guid cannot bloat the index.
  if (item.guid) return `guid:${sha(normalise(item.guid))}`;
  if (item.link) return `link:${sha(canonicalUrl(item.link))}`;

  // Last resort. DATE ONLY, never a timestamp — feeds jitter pubDate by seconds, and a
  // timestamp here would duplicate every item on every run.
  const day = item.publishedAt ? item.publishedAt.slice(0, 10) : "";
  return `sha:${sha([normalise(item.title), day, normalise(item.agency ?? "")].join("|"))}`;
}

/**
 * A tender linked from inside a digest email. Keyed on the portal's own detail-page id, so
 * the same tender in tomorrow's digest is recognised.
 *
 * NEVER key on position within the email — digests reorder between sends.
 */
export function externalRefForEmailLink(prefix: string, href: string): string {
  const id = atmId(href);
  if (id) return `atm:${id}`;
  return `${prefix}:${sha(canonicalUrl(href))}`;
}

/**
 * A whole email as one item. Used for direct client invitations (no portal id exists) and
 * as the fallback when a digest parses to zero items — see the zero-item alarm in scan.ts.
 */
export function externalRefForMessage(messageId: string, rawFallback?: string): string {
  const basis = messageId?.trim() ? normalise(messageId) : (rawFallback ?? "");
  return `msg:${sha(basis)}`;
}

/**
 * Cross-source fingerprint, for spotting the same tender arriving via two portals.
 *
 * Deliberately NOT used as a unique key: two different councils genuinely do both publish
 * "Dilapidation Survey Services", and a hard constraint would silently discard a real
 * opportunity. Callers soft-link with duplicate_of and surface the suppression as a
 * dashboard counter instead.
 */
export function contentHash(item: {
  title: string;
  agency?: string | null;
  closesAt?: string | null;
}): string {
  return sha(
    [
      normalise(item.title).toLowerCase(),
      normalise(item.agency ?? "").toLowerCase(),
      item.closesAt ? item.closesAt.slice(0, 10) : "",
    ].join("|")
  );
}
