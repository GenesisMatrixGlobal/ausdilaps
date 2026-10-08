// Core Web Vitals collector. Public by necessity — it is called by every visitor's browser,
// and a visitor has no session. So everything here is bounded before it reaches the database.
//
// The payload arrives via navigator.sendBeacon, which fires as the page is being torn down.
// That means: no response is ever read by the client, and the request may arrive after the
// page is gone. Both are fine — answer 204 and move on.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { looksLikeBot } from "@/lib/page-views";
import { recordVitals } from "@/lib/web-vitals";

/** Sanity ceilings, not precision limits. A 10-minute LCP is a broken clock or a forged
 *  payload, never a measurement worth keeping, and storing it would wreck the percentile. */
const ms = z.number().finite().min(0).max(600_000).optional().nullable();
/** Staff timings, logged only. A minute is already a broken page, not a slow one. */
const diagnosticMs = z.number().finite().min(0).max(60_000).optional();
/** For the log lines: "812ms", or "?" when the browser could not say. */
const msOr = (v: number | null | undefined) => (v == null ? "?" : `${Math.round(v)}ms`);

const schema = z.object({
  // Pathname only. Capped, and anything with a query string or a scheme is rejected rather
  // than cleaned — a well-behaved client never sends one, so a malformed path is a signal.
  // No control characters either: the path is now printed into the function log
  // ("[vitals] nav <path> …"), and an escape sequence there would reach whoever reads it.
  path: z.string().min(1).max(300).regex(/^\/[^?#\s\x00-\x1f\x7f]*$/, "pathname only"),
  device: z.enum(["mobile", "desktop"]),
  lcp: ms,
  inp: ms,
  cls: z.number().finite().min(0).max(100).optional().nullable(),
  fcp: ms,
  ttfb: ms,
  /** The biggest layout shift's elements, logged (not stored) when CLS is past "good". */
  clsTarget: z.string().max(400).optional(),
  /** How the page loaded ("prerender" = before the visitor clicked) and how many client-side
   *  route changes followed. Logged beside clsTarget, not stored — diagnostics for the mobile
   *  CLS, not a dashboard figure. */
  navType: z.string().max(30).regex(/^[a-z-]+$/).optional(),
  navs: z.number().int().min(0).max(1000).optional(),
  /** Staff-page timings, LOGGED and never stored — there is no column for them and no
   *  migration. serverMs/htmlMs ride on a hard load's beacon (web-vitals-reporter.tsx), and
   *  `.catch` drops a bad one on its own: an odd browser timing must not cost the real
   *  vitals row it arrived with. */
  serverMs: diagnosticMs.catch(undefined),
  htmlMs: diagnosticMs.catch(undefined),
  /** A Command Centre tab click, a beacon of its own (components/staff/nav-timer.tsx).
   *  ⚠️ Deliberately NO `.catch`: a bad navMs fails the whole payload. Softened to undefined
   *  it would fall through towards the insert, kept out only by the nav beacon happening to
   *  carry no metric. A nav must never become a row, so any payload carrying the key either
   *  logs as a nav or is dropped — by construction, not by coincidence. */
  navMs: diagnosticMs,
  /** navMs only: whether the loading skeleton showed, and whether the timer gave up on it. */
  skeleton: z.boolean().optional().catch(undefined),
  gaveUp: z.boolean().optional().catch(undefined),
});

export async function POST(req: NextRequest) {
  // Bots mostly don't run JavaScript, so this endpoint is naturally cleaner than the page
  // view counter — but headless Chrome does, and that is what our own tests drive.
  if (looksLikeBot(req.headers.get("user-agent"))) return new NextResponse(null, { status: 204 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return new NextResponse(null, { status: 204 });
  const d = parsed.data;
  // Everything that is not a web_vitals column comes off here. recordVitals maps its columns
  // by name, so a stray field could not reach the insert anyway — this keeps it obvious.
  const { clsTarget, navType, navs, serverMs, htmlMs, navMs, skeleton, gaveUp, ...sample } = d;

  // Read in the Vercel function log: `vercel logs ausdilaps.com.au` filtered on "[vitals]".
  //
  // ⚠️ A tab click is logged and RETURNS here, before the database, whatever else the
  // payload carries. It is not a page view, and a row for it would skew every percentile.
  if (navMs != null) {
    const how = gaveUp
      ? "still loading, gave up"
      : skeleton == null
        ? "?"
        : skeleton
          ? "skeleton"
          : "no skeleton";
    console.log(
      `[vitals] nav ${d.path} ${gaveUp ? ">" : ""}${Math.round(navMs)}ms (${d.device}, ${navType ?? "?"}, ${how})`
    );
    return new NextResponse(null, { status: 204 });
  }
  if (serverMs != null || htmlMs != null) {
    // ttfb beside them because it is the number the dashboard stores, and on a page behind
    // Early Hints it says almost nothing about the server — see serverTiming() in
    // components/marketing/web-vitals-reporter.tsx.
    console.log(
      `[vitals] load ${d.path} server=${msOr(serverMs)} html=${msOr(htmlMs)} ttfb=${msOr(d.ttfb)} (${d.device}, ${navType ?? "?"})`
    );
  }

  // A row with no metric at all is not a measurement. Dropping it keeps the sample count
  // honest — it is used as the denominator on the dashboard.
  if (d.lcp == null && d.inp == null && d.cls == null && d.fcp == null && d.ttfb == null) {
    return new NextResponse(null, { status: 204 });
  }

  if ((d.cls ?? 0) > 0.1) {
    console.warn(
      `[vitals] shift ${d.cls} on ${d.path} (${d.device}, ${navType ?? "?"}, ${navs ?? 0} navs): ${clsTarget ?? "no target (Safari, or shift before observer)"}`
    );
  }
  await recordVitals(sample);
  return new NextResponse(null, { status: 204 });
}
