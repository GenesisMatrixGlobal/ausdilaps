/**
 * Shown the instant a Command Centre tab is clicked, inside the header and nav.
 *
 * Every page here is rendered per request. Without this file a click did nothing visible
 * until the server finished, which read as a frozen page. It also bounds PREFETCHING: a
 * dynamic route prefetches only down to its loading boundary, so opening one tab no longer
 * renders all seven on the server (seen in the logs: seven full renders within a second
 * of opening /admin, each thrown away, then each click rendering again).
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
