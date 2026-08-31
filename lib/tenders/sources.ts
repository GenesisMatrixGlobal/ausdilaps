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

/**
 * The code-owned sources. RSS only.
 *
 * Email sources are NOT here — they are discovered from sender domains and read from
 * tender_sources at scan time (see sources/mailbox.ts). The SSRF argument above is why the
 * two are treated differently: a feed URL from the database could redirect a server-side
 * fetch at an internal host, whereas a discovered domain only filters mail we already
 * hold. Nothing is fetched from it.
 */
export function enabledSources(): SourceDefinition[] {
  return SOURCES.filter((s) => s.configured());
}

export function getSource(slug: string): SourceDefinition | undefined {
  return SOURCES.find((s) => s.slug === slug);
}
