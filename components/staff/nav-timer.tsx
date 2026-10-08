"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { NavStart } from "@/instrumentation-client";

/** The Command Centre's loading skeleton (app/admin/loading.tsx) — the only element in the
 *  app carrying both attributes. Change that file's markup and this goes blind silently. */
const SKELETON = '[role="status"][aria-label="Loading"]';
/** Stop watching a page that still hasn't shown its content. Reported as "gave up" rather
 *  than dropped, because a 20-second tab is exactly what this exists to catch — and that
 *  includes a navigation that only COMMITS after 20s (no prefetch, cold server). */
const GIVE_UP_MS = 20_000;
/** The vitals route's ceiling for navMs — a background tab can fire the give-up late. */
const MAX_MS = 60_000;

/**
 * Times a Command Centre tab click, start to content, and logs it via /api/vitals. Logged in
 * the function log ("[vitals] nav …"), NEVER stored — the route drops a nav beacon before the
 * database. Web Vitals only ever describe the hard load, so without this the thing Rhys
 * actually waits on, a tab click, was not measured at all.
 *
 * Start: instrumentation-client.ts notes the moment a navigation starts. End: the new route
 * has committed AND app/admin/loading.tsx's skeleton is gone.
 *
 * ⚠️ Both halves of the end are needed. With loading.tsx the route — and the URL — commit
 * when the SKELETON does, not the content, so "the path changed" alone would report every
 * slow tab as instant. A tab served from the router cache never shows a skeleton at all, so
 * that one ends at the commit. The commit is read from usePathname/useSearchParams (router
 * state), not location: on back/forward the browser changes location BEFORE the router has
 * drawn anything.
 *
 * Latest wins: a click on another tab replaces the note, and a measurement still waiting on
 * the old one is dropped unsent rather than timed to whatever the newer click drew.
 *
 * Mounted once, in app/admin/layout.tsx. A navigation away from /admin unmounts it; one
 * into /admin from the staff portal is picked up on mount, from the same note.
 */
export function NavTimer() {
  const pathname = usePathname();
  // A dependency of the effect on its own: the month links on /admin/usage change only the
  // query string, and that navigation commits without the path changing.
  const search = useSearchParams().toString();

  useEffect(() => {
    const start = window.__adNavStart;
    // Not a navigation to what just committed (a hard load, or a click on another tab still
    // in flight), or one already measured.
    if (!start || start.done || start.path !== pathname) return;
    // Both sides through URLSearchParams: the hook's string re-encodes (a space becomes
    // "+"), the note keeps the href's own spelling.
    if (new URLSearchParams(start.search).toString() !== search) return;

    const skeleton = skeletonShowing();
    const finish = (gaveUp: boolean) => {
      if (start.done) return;
      start.done = true; // synchronously, so a strict-mode re-run can't send it twice
      // The end is taken NOW; the frame is only a short wait for the paint. Read inside the
      // frame callback, a tab hidden in between would hold the frame — and the clock — until
      // it was shown again.
      const at = performance.now();
      afterFrame(() => send(start, skeleton, gaveUp, Math.min(performance.now(), at + 100)));
    };

    // Committed only after the give-up: report it now rather than watch a further 20s. A
    // matching note this old can only be a slow commit — every navigation writes a new note,
    // and a click on the tab already open commits nothing, so this effect never re-runs for it.
    if (performance.now() - start.t > GIVE_UP_MS) {
      finish(skeleton);
      return;
    }

    // Already showing content: a tab reused from the router cache (staleTimes).
    if (!skeleton) {
      finish(false);
      return;
    }

    // ⚠️ The latest-wins check matters here, not just in the effect above. A click on a
    // cached tab while this one is still loading swaps the skeleton out for the OTHER tab's
    // content in a single commit — the observer sees the skeleton go before React has run
    // the cleanup below, and would otherwise report that as this tab loading.
    const superseded = () => window.__adNavStart !== start;
    const observer = new MutationObserver(() => {
      if (!superseded() && skeletonShowing()) return;
      stop();
      if (!superseded()) finish(false);
    });
    // `style`/`hidden` as well as children: a skeleton can also stop showing by being hidden
    // (display:none on it or an ancestor) rather than removed, and that counts as done.
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "hidden"],
    });
    const timer = setTimeout(
      () => {
        stop();
        if (!superseded()) finish(skeletonShowing());
      },
      Math.max(0, GIVE_UP_MS - (performance.now() - start.t))
    );
    function stop() {
      observer.disconnect();
      clearTimeout(timer);
    }
    // Also the cleanup: a newer navigation committing (or leaving /admin) abandons this
    // one unsent.
    return stop;
  }, [pathname, search]);

  return null;
}

function skeletonShowing(): boolean {
  // getClientRects is empty for a display:none element or one inside a hidden subtree.
  return [...document.querySelectorAll(SKELETON)].some((el) => el.getClientRects().length > 0);
}

/** Runs `fn` as the frame holding the change is drawn. Straight away in a hidden tab, where
 *  requestAnimationFrame never fires — the wait would otherwise run until the tab is shown. */
function afterFrame(fn: () => void) {
  if (document.visibilityState === "hidden") fn();
  else requestAnimationFrame(() => fn());
}

function send(start: NavStart, skeleton: boolean, gaveUp: boolean, end: number) {
  const body = JSON.stringify({
    // Pathname only — the vitals route rejects a query string, so `search` never leaves.
    path: start.path,
    // The route requires it, and the log line reads better with it.
    device: window.innerWidth < 768 ? "mobile" : "desktop",
    navMs: Math.min(MAX_MS, Math.round(end - start.t)),
    navType: start.type,
    skeleton,
    ...(gaveUp ? { gaveUp: true } : {}),
  });
  try {
    navigator.sendBeacon?.("/api/vitals", new Blob([body], { type: "application/json" }));
  } catch {
    // Diagnostics only; a blocked beacon is not worth an error.
  }
}
