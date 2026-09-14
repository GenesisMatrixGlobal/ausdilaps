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

const schema = z.object({
  // Pathname only. Capped, and anything with a query string or a scheme is rejected rather
  // than cleaned — a well-behaved client never sends one, so a malformed path is a signal.
  path: z.string().min(1).max(300).regex(/^\/[^?#\s]*$/, "pathname only"),
  device: z.enum(["mobile", "desktop"]),
  lcp: ms,
  inp: ms,
  cls: z.number().finite().min(0).max(100).optional().nullable(),
  fcp: ms,
  ttfb: ms,
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

  // A row with no metric at all is not a measurement. Dropping it keeps the sample count
  // honest — it is used as the denominator on the dashboard.
  if (d.lcp == null && d.inp == null && d.cls == null && d.fcp == null && d.ttfb == null) {
    return new NextResponse(null, { status: 204 });
  }

  await recordVitals(d);
  return new NextResponse(null, { status: 204 });
}
