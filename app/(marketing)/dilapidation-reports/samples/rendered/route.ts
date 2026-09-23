// "This page was actually drawn on a screen" — the beacon behind `page_views.rendered`
// (migration 0023).
//
// The view itself is counted in proxy.ts from request headers alone, and headers cannot tell
// a person from a headless browser: the scrapers measured on 2026-09-23 announced themselves
// as desktop Chrome and sent `sec-fetch-dest: document`, so they passed every check there is.
// A First Contentful Paint is the one thing they do not produce, because producing it means
// actually rendering the page.
//
// Public by necessity and bounded exactly like the click beacon: same-origin only, the bot
// filter, and the visitor cookie. It takes NO body — there is nothing to say beyond "I
// painted" — and it deliberately does NOT require the access cookie, because a locked-page
// view needs confirming just as much as an unlocked one. It sets no cookie and creates no
// row; the worst a forged call can do is mark one of that visitor's own recent views as
// painted, which is the same claim the page itself would have made.

import { NextRequest, NextResponse, after } from "next/server";
import { SAMPLES_VISITOR_COOKIE, isVisitorId } from "@/lib/samples-access";
import { looksLikeBot, markRendered } from "@/lib/page-views";

export async function POST(req: NextRequest) {
  const ok = new NextResponse(null, { status: 204 });

  // sendBeacon sends `sec-fetch-site: same-origin`; anything else is not our page.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return ok;
  if (looksLikeBot(req.headers.get("user-agent"))) return ok;

  const visitorId = req.cookies.get(SAMPLES_VISITOR_COOKIE)?.value;
  if (!isVisitorId(visitorId)) return ok;

  after(() => markRendered(visitorId));
  return ok;
}
