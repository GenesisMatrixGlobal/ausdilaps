import { fetchFeed } from "./sources/feed";
import { fetchMailboxSource, mailboxConfigured } from "./sources/mailbox";
import { MAILBOX_SOURCES } from "./senders";
import type { SourceDefinition } from "./types";

// Re-exported so existing importers keep working after these moved to ./senders to break
// an import cycle with ./sources/mailbox.
export { trustedSenderDomains, isTrustedSender } from "./senders";

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

  // One mailbox, one source per portal that writes to it. They share a single Graph fetch
  // per run (see sources/mailbox.ts) but keep separate runs, raw payloads and gone-quiet
  // counters — which is what makes "buy.nsw has produced nothing for 5 runs" answerable.
  //
  // All of them turn on together, because they are all the same mailbox: either Graph is
  // configured or none of them can run.
  ...MAILBOX_SOURCES.map(
    (source): SourceDefinition => ({
      slug: source.slug,
      label: source.label,
      kind: "email",
      configured: mailboxConfigured,
      fetch: (since: string) => fetchMailboxSource(source, since),
    })
  ),
];

export function enabledSources(): SourceDefinition[] {
  return SOURCES.filter((s) => s.configured());
}

export function getSource(slug: string): SourceDefinition | undefined {
  return SOURCES.find((s) => s.slug === slug);
}
