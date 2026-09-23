"use client";

import { useEffect } from "react";
import { SAMPLES_RENDERED_PATH } from "@/lib/samples-access";

/**
 * Tells the server this page was actually PAINTED (migration 0024).
 *
 * The view is counted server-side in proxy.ts, where the only evidence is request headers —
 * and headers cannot separate a person from a headless browser. A First Contentful Paint can:
 * it means the browser composited pixels, which a fetch-and-discard client does not do.
 *
 * ⚠️ It waits for the REAL `first-contentful-paint` PerformanceEntry, not a mount, an effect
 * or a rAF. All three of those run in a headless browser too — React hydrating is not a
 * person looking at something. `buffered: true` matters because on a fast page the paint has
 * usually already happened by the time this effect runs, and a plain observer would wait for
 * an entry that will never come again.
 *
 * Fires once, needs no body, and never blocks or logs on a visitor's page.
 */
export function SamplesRenderedBeacon() {
  useEffect(() => {
    let done = false;
    const send = () => {
      if (done) return;
      done = true;
      try {
        navigator.sendBeacon?.(SAMPLES_RENDERED_PATH);
      } catch {
        // A blocked beacon is not worth a console error on a visitor's page.
      }
    };

    let observer: PerformanceObserver | undefined;
    try {
      // Already painted before this ran? `buffered` replays it immediately.
      if (performance.getEntriesByName("first-contentful-paint").length > 0) {
        send();
      } else {
        observer = new PerformanceObserver((list) => {
          if (list.getEntries().some((e) => e.name === "first-contentful-paint")) send();
        });
        observer.observe({ type: "paint", buffered: true });
      }
    } catch {
      // A browser without the paint API is rare and is not worth guessing about: no beacon,
      // so the view stays uncounted rather than being counted on weaker evidence.
    }

    return () => observer?.disconnect();
  }, []);

  return null;
}
