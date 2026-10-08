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

      const path = landing.current || window.location.pathname;
      const body = JSON.stringify({
        path,
        device: window.innerWidth < 768 ? "mobile" : "desktop",
        ...m,
        ...(shift.current ? { clsTarget: shift.current } : {}),
        ...(navType.current ? { navType: navType.current.slice(0, 30) } : {}),
        navs: navs.current,
        // Logged by the route, never stored. Staff pages only: they are rendered per
        // request, so server time is the thing worth knowing there — see serverTiming().
        ...(STAFF_PATH.test(path) ? serverTiming() : {}),
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

/** Staff and Command Centre pages — the only ones whose server time is sent. */
const STAFF_PATH = /^\/(admin|staff)(\/|$)/;

/** Not in lib.dom yet. Undefined outside Chromium (and finalResponseHeadersStart before
 *  Chrome 133); 0 when no 103 arrived. */
type NavTiming = PerformanceNavigationTiming & {
  firstInterimResponseStart?: number;
  finalResponseHeadersStart?: number;
};

/**
 * How long the server took on a hard load, for the /api/vitals log line — not stored.
 *
 * ⚠️ The stored TTFB cannot answer that, and it is deliberately left meaning what it means.
 * Vercel sends an empty HTTP 103 (Early Hints) ahead of the page, Chromium sets
 * `responseStart` when the 103 lands, and web-vitals' TTFB is `responseStart` (less any
 * prerender activation) — so it times the 103's round trip and excludes ALL server time. A
 * slow Command Centre render still shows a fast TTFB. The real response's headers are what
 * mark the server producing its first byte of HTML:
 *
 *   serverMs: the 103 landing → the real response's headers. The 103 goes out before the
 *             function runs, so this is close to pure server time. With no 103 it runs from
 *             the request being sent, and so also carries one network round trip.
 *   htmlMs:   those headers → the last byte. Pages stream, so this includes every Suspense
 *             boundary resolving on the server (the PageSpeed rows on /admin).
 *
 * Read at hide time, when the document has long finished loading. A prerendered page did
 * this work before the visitor clicked — the log line carries the navType to tell.
 */
function serverTiming(): { serverMs?: number; htmlMs?: number } {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as NavTiming | undefined;
    if (!nav) return {};
    const interim = nav.firstInterimResponseStart || 0;
    // A 103 arrived but this browser can't say when the real headers did (Chromium before
    // 133): `responseStart` is the 103 itself, so any figure here would be a confident 0.
    const headers = nav.finalResponseHeadersStart || (interim ? 0 : nav.responseStart);
    const sent = interim || nav.requestStart;
    if (!headers || !sent) return {};
    const out: { serverMs?: number; htmlMs?: number } = {};
    const server = headers - sent;
    // responseEnd is 0 while the document is still streaming — left out, not sent negative.
    const html = nav.responseEnd ? nav.responseEnd - headers : -1;
    if (inRange(server)) out.serverMs = Math.round(server);
    if (inRange(html)) out.htmlMs = Math.round(html);
    return out;
  } catch {
    return {};
  }
}

/** The vitals route's bounds for these two. It drops an out-of-range value on its own, but
 *  there is no reason to send one. */
const inRange = (v: number) => Number.isFinite(v) && v >= 0 && v <= 60_000;

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
