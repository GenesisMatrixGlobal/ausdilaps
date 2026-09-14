"use client";

import { useEffect, useRef } from "react";
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

  useReportWebVitals((metric) => {
    // Next reports its own custom timings (hydration, render) alongside the web vitals.
    // Only the standard five are stored; the rest are noise at this level.
    const key = metric.name.toLowerCase();
    if (["lcp", "inp", "cls", "fcp", "ttfb"].includes(key)) {
      metrics.current[key] = metric.value;
    }
  });

  useEffect(() => {
    function send() {
      // Once per page view. A page can be hidden and shown repeatedly (tab switching), and
      // every one of those would otherwise post the same numbers again.
      if (sent.current) return;
      const m = metrics.current;
      if (Object.keys(m).length === 0) return;
      sent.current = true;

      const body = JSON.stringify({
        path: window.location.pathname,
        device: window.innerWidth < 768 ? "mobile" : "desktop",
        ...m,
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
    document.addEventListener("visibilitychange", onHide);
    // pagehide is the belt to visibilitychange's braces — it fires on a real navigation away
    // in browsers that do not freeze the page. NOT deferred: this one can be the last code
    // to run, so a timeout here would never fire. The `sent` guard makes the overlap safe.
    window.addEventListener("pagehide", send);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", send);
    };
  }, []);

  return null;
}
