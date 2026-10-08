/**
 * Shown the instant a Command Centre tab is clicked, inside the header and nav.
 *
 * Every page here is rendered per request. Without this file a click did nothing visible
 * until the server finished, which read as a frozen page.
 *
 * ⚠️ It does NOT change prefetching between tabs, and an earlier version of this comment
 * (and commit 80bb943's message) said it did. On this non-PPR app a default <Link> prefetch
 * of a sibling tab is a route-tree request plus a metadata-only request: neither runs the
 * admin layout or a page loader, with or without this file (read in Next 16.3.8's
 * segment-cache scheduler, 2026-10-08). The burst of /admin requests in the logs is those.
 * What it DOES change: prefetching /admin from OUTSIDE it (the staff header's Command Centre
 * link, the website's CommandCentreLink) now renders AdminLayout down to this boundary —
 * one getUser + profiles read, cached ~5 min — which is what lets that click paint the
 * header, nav and skeleton at once. A deliberate trade.
 *
 * ⚠️ Keep AdminNav on the DEFAULT prefetch. prefetch={true} would render every tab's page
 * on every load; prefetch={false} makes a click wait for the server before anything paints,
 * because the skeleton relies on the cached route tree. That cache goes stale after ~5 min,
 * which is why the nav links also carry a useLinkStatus pending dot (LinkPending).
 *
 * React holds a shown fallback for at least ~300ms, so on a fast warm tab content can land
 * a little later than without the skeleton. Judge speed on click-to-content (the
 * `[vitals] nav` log line), not on how soon the skeleton appears.
 *
 * Deliberately generic — a heading, a row of tiles, two panels — so it sits under every
 * tab without pretending to know the page's layout.
 */
export default function AdminLoading() {
  const block = "rounded-xl bg-ad-surface motion-safe:animate-pulse";
  return (
    <div role="status" aria-label="Loading">
      <div className={`h-8 w-56 ${block}`} />
      <div className={`mt-2.5 h-4 w-full max-w-md ${block}`} />
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`h-20 ${block}`} />
        ))}
      </div>
      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <div className={`h-64 lg:col-span-2 ${block}`} />
        <div className={`h-64 ${block}`} />
      </div>
    </div>
  );
}
