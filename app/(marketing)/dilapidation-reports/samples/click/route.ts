// "This file was opened" — the beacon the library fires when a row is clicked (migration
// 0021). The rows themselves link straight to Box, so without this the only thing we know
// is that someone reached the list.
//
// Public by necessity (a visitor has no session), and bounded the same way /api/vitals is:
// a tiny zod shape, the bot filter, same-origin only, and the two cookies — the access
// cookie proves they are unlocked (you cannot click a row on the locked page), and the
// visitor cookie is what ties the click to their views. Neither is set by this route.
//
// Lives under /dilapidation-reports/samples rather than /api because both cookies are scoped
// to /dilapidation-reports and would not be sent to /api/*. proxy.ts's samplesGate passes
// this path straight through.

import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { SAMPLES_COOKIE, SAMPLES_VISITOR_COOKIE, isValidCookie, isVisitorId } from "@/lib/samples-access";
import { looksLikeBot, recordPageView } from "@/lib/page-views";

const schema = z.object({
  item: z.string().trim().min(1).max(200),
  category: z.string().trim().max(60).optional().default(""),
});

export async function POST(req: NextRequest) {
  const ok = new NextResponse(null, { status: 204 });

  // sendBeacon sends `sec-fetch-site: same-origin`; anything else is not our page.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return ok;
  if (looksLikeBot(req.headers.get("user-agent"))) return ok;

  const visitorId = req.cookies.get(SAMPLES_VISITOR_COOKIE)?.value;
  if (!isVisitorId(visitorId)) return ok;
  if (!(await isValidCookie(req.cookies.get(SAMPLES_COOKIE)?.value))) return ok;

  // sendBeacon posts a plain string, so the body is text — parse it ourselves.
  let parsed: z.infer<typeof schema>;
  try {
    parsed = schema.parse(JSON.parse(await req.text()));
  } catch {
    return ok;
  }

  const item = parsed.category ? `${parsed.category} · ${parsed.item}` : parsed.item;
  after(() =>
    recordPageView("click_item", {
      visitorId,
      item,
      referrer: req.headers.get("referer"),
      userAgent: req.headers.get("user-agent"),
    })
  );
  return ok;
}
