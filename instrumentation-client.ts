// Client instrumentation. Next runs this before hydration on EVERY page, the marketing site
// included, so ⚠️ keep it tiny and import nothing — it is in the bundle every visitor gets.
//
// All it does is note when an App Router navigation STARTS. components/staff/nav-timer.tsx
// reads the note when the new page commits and times how long a Command Centre tab click
// took to show its content. Nothing is sent from here.

export type NavStart = {
  /** Pathname being navigated to — never the query string, which the vitals route rejects. */
  path: string;
  /** Its query string, as given. Matched, never sent: the month links on /admin/usage change
   *  only this, and a note must not be matched by a different query on the same page. */
  search: string;
  type: "push" | "replace" | "traverse";
  /** performance.now() at the start. Same document across soft navigations, so it subtracts. */
  t: number;
  /** Set by the nav timer once this navigation is measured, so it is never sent twice. */
  done?: boolean;
};

declare global {
  interface Window {
    __adNavStart?: NavStart;
  }
}

/** Matches the nav timer's give-up. An older unmeasured note is history, not a click. */
const STALE_MS = 20_000;

// ⚠️ TWO arguments, never the third. Next 16.3 passes an `event` that is NULL unless
// experimental.instrumentationClientRouterTransitionEvents is set, so reading
// event.timestamp throws — and Next swallows hook errors into a console.error, so the
// timer would silently never start. performance.now() here is the same moment anyway.
export function onRouterTransitionStart(url: string, navigationType: NavStart["type"]) {
  try {
    // `url` is the href as given for a push/replace (often relative) and absolute for
    // back/forward — resolved against the current page exactly as Next resolves it.
    const u = new URL(url, window.location.href);
    const prev = window.__adNavStart;
    // A second click on the SAME target while the first is still loading keeps the first
    // click's start: that is when the wait began. A new note would also orphan it — the URL
    // does not change again, so the timer would never look at the new one. Any OTHER target
    // replaces the note (latest wins), which abandons the earlier measurement unsent.
    if (
      prev &&
      !prev.done &&
      prev.path === u.pathname &&
      prev.search === u.search &&
      performance.now() - prev.t < STALE_MS
    ) {
      return;
    }
    window.__adNavStart = {
      path: u.pathname,
      search: u.search,
      type: navigationType,
      t: performance.now(),
    };
  } catch {
    // An unparseable URL is not worth an error on a visitor's page; the navigation goes on.
  }
}
