import { vendorPanelDetails } from "./sources/extract/vendorpanel";
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
    /**
     * Commonwealth ATMs. The URL is HARDCODED like VendorPanel's below, because gating it on
     * an env var is what kept this source at zero items from the day it was written — nobody
     * ever set it, and the dashboard showed a source that looked merely quiet.
     *
     * ⚠️ `/public_data/rss/rss.xml`, NOT `/atm/rss` or the other forms tried first — all of
     * those 403. robots.txt disallows /Search/*, /Reports/*, /Cn/List*, /Son/List* and
     * /admin*; /public_data/ is permitted, and the site links this feed from its own help
     * page. The 403s were the WAF's User-Agent rule, not the path — see feed.ts.
     */
    configured: () => true,
    fetch: async () =>
      fetchFeed(
        process.env.TENDER_AUSTENDER_FEED_URL ?? "https://www.tenders.gov.au/public_data/rss/rss.xml",
        "austender-atm"
      ),
  },
  {
    slug: "vendorpanel-public",
    label: "VendorPanel — public tenders",
    kind: "rss",
    /**
     * The council aggregator. ~400 open tenders across 250+ councils and agencies, and the
     * biggest gap in the email sources — most councils publish here and nowhere we watch.
     *
     * ⚠️ Registration is NOT needed to read this. The feed is linked from the public
     * /publictenders.aspx page and robots.txt is `Allow: /`. Checked before building it;
     * registering only matters when we want to RESPOND to something.
     *
     * The URL is HARDCODED rather than env-gated, unlike AusTender above. That one has sat
     * unconfigured since it was written and has never returned an item — an env var is a
     * step someone has to take, and a public feed with a stable address does not need one.
     * `TENDER_VENDORPANEL_FEED_URL` overrides it if the address ever moves.
     */
    configured: () => true,
    fetch: async () =>
      fetchFeed(
        process.env.TENDER_VENDORPANEL_FEED_URL ??
          "https://www.vendorpanel.com.au/PublicTendersRssV2.aspx?mode=all",
        "vendorpanel-public",
        // See FeedOptions: VendorPanel's <category> is the procurement class, not the buyer.
        // The buyer, state and closing date come from the labelled tail of each description.
        { agencyFromCategory: false, details: vendorPanelDetails }
      ),
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
