import { fetchFeed } from "./sources/feed";
import type { SourceDefinition } from "./types";

/**
 * The source registry — mirrors the shape of lib/tools/registry.ts.
 *
 * Code owns *what* a source is; the tender_sources table only remembers how it has been
 * *behaving*. Two reasons that split matters:
 *
 *   1. A feed URL living in the database means a database write could redirect the nightly
 *      server-side fetch at an internal host. Keeping URLs in code removes that SSRF path
 *      entirely.
 *   2. Adding a source is then a reviewed diff, not an undocumented row someone added in
 *      the Supabase console at 11pm.
 *
 * `slug` must match a row seeded in migration 0006.
 *
 * A blank env var means `configured()` is false and the scan skips the source cleanly
 * rather than recording a failure — so an unconfigured source reads as "off", not "broken".
 */
export const SOURCES: SourceDefinition[] = [
  {
    slug: "austender-atm",
    label: "AusTender — ATM feed",
    kind: "rss",
    configured: () => !!process.env.TENDER_AUSTENDER_FEED_URL,
    fetch: async () =>
      fetchFeed(process.env.TENDER_AUSTENDER_FEED_URL as string, "austender-atm"),
  },
];

export function enabledSources(): SourceDefinition[] {
  return SOURCES.filter((s) => s.configured());
}

export function getSource(slug: string): SourceDefinition | undefined {
  return SOURCES.find((s) => s.slug === slug);
}

/**
 * Sender domains whose mail we treat as coming from the portal it claims to be.
 *
 * Trust is a signal, never a gate: an unverified sender is still stored and still
 * classified, it is just badged in the UI and — until TENDER_FORWARD_UNTRUSTED is turned
 * on — kept out of the digest. Anyone on the internet can email the monitored inbox, so
 * this distinction has to exist somewhere.
 */
export function trustedSenderDomains(): string[] {
  return (process.env.TENDER_TRUSTED_SENDER_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function isTrustedSender(from: string | null | undefined): boolean {
  if (!from) return false;
  const domain = from.split("@").pop()?.replace(/>$/, "").trim().toLowerCase();
  if (!domain) return false;
  return trustedSenderDomains().some((d) => domain === d || domain.endsWith(`.${d}`));
}
