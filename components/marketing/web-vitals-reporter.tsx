"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";

/**
 * Collects this page view's Core Web Vitals and posts them ONCE, as the page is hidden.
 *
 * Why accumulate rather than send each metric as it arrives: the five metrics land at
 * different moments — TTFB and FCP during load, LCP when the biggest element paints, CLS as
 * the layout settles, INP only if the visitor actually interacts. Sending each one would be
 * five requests and five database rows per page view, and would make every dashboard query
 * a pivot. One row per view is both cheaper and the shape you actually want to read.
 *
 * Sent with `sendBeacon`, which is the only transport the browser guarantees to deliver
 * while a page is being torn down. A normal fetch on pagehide is routinely cancelled.
 *
 * Fires on `visibilitychange` → hidden, NOT on `beforeunload`: on iOS Safari a page is
 * frozen and reused rather than unloaded, so beforeunload often never runs and the whole
 * mobile half of the sample would go missing — which is the half most likely to be slow.
 */
export function WebVitalsReporter() {
  const metrics = useRef<Record<string, number>>({});
  const sent = useRef(false);
  /** The single largest layout shift's elements, for the server log — see biggestShift(). */
  const shift = useRef<string>("");
  // ⚠️ The page the visitor LANDED on, not the one open when they leave. This sits in the
  // root layout, so it outlives client-side navigation, and LCP/FCP/TTFB belong to the hard
  // load. Reading location at hide time filed a visit that landed on /quote and left from /
  // under "/" (2026-10-06 sweep).
  const landing = useRef<string>("");
  /** Client-side route changes during the visit. CLS keeps accumulating across them, so a
   *  big shift with navs > 0 may have happened on a later page, not the landing one. */
  const navs = useRef(0);
  /** "navigate", "reload", "back-forward", "prerender"… — prerender is Chrome loading the
   *  page before the visitor clicked, which is one suspect for the mobile CLS. */
  const navType = useRef<string>("");
  const pathname = usePathname();

  useReportWebVitals((metric) => {
    // Next reports its own custom timings (hydration, render) alongside the web vitals.
    // Only the standard five are stored; the rest are noise at this level.
    const key = metric.name.toLowerCase();
    if (["lcp", "inp", "cls", "fcp", "ttfb"].includes(key)) {
      metrics.current[key] = metric.value;
    }
    if (!navType.current && typeof metric.navigationType === "string") {
      navType.current = metric.navigationType;
    }
  });

  // Runs once on mount, then once per route change. The landing path is read from location,
  // not the hook — the samples page is a middleware REWRITE, and the visible URL is the one
  // the dashboard reports.
  // Compared against the last path rather than counted per run, so React's dev double-run
  // of effects can't count a navigation that never happened.
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    if (lastPath.current === null) landing.current = window.location.pathname;
    else if (pathname !== lastPath.current) navs.current += 1;
    lastPath.current = pathname;
  }, [pathname]);

  useEffect(() => {
    function send() {
      // Once per page view. A page can be hidden and shown repeatedly (tab switching), and
      // every one of those would otherwise post the same numbers again.
      if (sent.current) return;
      const m = metrics.current;
      if (Object.keys(m).length === 0) return;
      sent.current = true;

      const body = JSON.stringify({
        path: landing.current || window.location.pathname,
        device: window.innerWidth < 768 ? "mobile" : "desktop",
        ...m,
        ...(shift.current ? { clsTarget: shift.current } : {}),
        ...(navType.current ? { navType: navType.current.slice(0, 30) } : {}),
        navs: navs.current,
      });
      try {
        navigator.sendBeacon?.("/api/vitals", new Blob([body], { type: "application/json" }));
      } catch {
        // A blocked beacon is not worth a console error on a visitor's page.
      }
    }

    // ⚠️ DEFERRED BY A TICK, and that is the whole reason LCP and CLS are ever captured.
    //
    // LCP and CLS are not final until the page is hidden — the web-vitals library settles
    // them in its OWN visibilitychange listener. Ours listens to the same event, so sending
    // straight away is a race we frequently lost: the first production samples came back
    // with LCP on 2 rows out of 6 and CLS on none, because we posted before those callbacks
    // ran. A 0ms timeout puts our send after every other listener for that event, and the
    // page is still alive when merely hidden, so there is time to use.
    function onHide() {
      if (document.visibilityState === "hidden") setTimeout(send, 0);
    }
    // Which element moved. A third of mobile homepage loads carried a CLS of 0.7-0.87 that
    // neither Lighthouse nor a warm-cache reload reproduces (2026-10-06); the value alone
    // can't say what shifted. Keeps the biggest non-input shift's first three sources as
    // "TAG.class prev→cur", read back from the /api/vitals log line. Not stored.
    let observer: PerformanceObserver | null = null;
    try {
      let biggest = 0;
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as LayoutShift[]) {
          if (entry.hadRecentInput || entry.value <= biggest) continue;
          biggest = entry.value;
          shift.current = describeShift(entry);
        }
      });
      observer.observe({ type: "layout-shift", buffered: true });
    } catch {
      // Safari has no layout-shift entries; CLS itself is already absent there.
    }
    document.addEventListener("visibilitychange", onHide);
    // pagehide is the belt to visibilitychange's braces — it fires on a real navigation away
    // in browsers that do not freeze the page. NOT deferred: this one can be the last code
    // to run, so a timeout here would never fire. The `sent` guard makes the overlap safe.
    window.addEventListener("pagehide", send);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", send);
    };
  }, []);

  return null;
}

type LayoutShift = PerformanceEntry & {
  value: number;
  hadRecentInput: boolean;
  sources?: { node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[];
};

function describeShift(entry: LayoutShift): string {
  const rect = (r: DOMRectReadOnly) => [r.x, r.y, r.width, r.height].map(Math.round).join(",");
  const parts = (entry.sources ?? []).slice(0, 3).map((s) => {
    const n = s.node;
    const el =
      n instanceof Element
        ? `${n.tagName}.${n.className && typeof n.className === "string" ? n.className.split(" ").slice(0, 3).join(".") : ""}`
        : "?";
    return `${el} ${rect(s.previousRect)}→${rect(s.currentRect)}`;
  });
  return `${entry.value.toFixed(3)}@${Math.round(entry.startTime)}ms ${parts.join(" | ")}`.slice(0, 400);
}
