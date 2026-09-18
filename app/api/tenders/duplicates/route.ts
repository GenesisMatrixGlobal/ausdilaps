import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccess, getStaffUser, isAdmin } from "@/lib/auth/session";
import { TENDER_WATCH_ALLOW_UNAUTHED_ENV, TENDER_WATCH_DEPARTMENTS } from "@/lib/tenders/config";
import { findOpportunitiesIn, parseLocality, type Locality } from "@/lib/tenders/salesforce-match";

/**
 * "Have we already quoted somewhere in this suburb?"
 *
 * Read-only against Salesforce, one SOQL query for the whole queue. Deliberately a SEPARATE
 * route rather than part of loadTenderSummary: the summary is also read by the nightly
 * health check and by the server component that renders the page, and neither should sit
 * waiting on Salesforce. The queue paints first, the badges arrive a moment later, and a
 * Salesforce outage costs the badges and nothing else.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({
  /** Locations as the notices state them; the route parses and dedupes them itself. */
  locations: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
});

export async function POST(req: NextRequest) {
  const user = await getStaffUser();
  const devHatch =
    process.env.NODE_ENV !== "production" && process.env[TENDER_WATCH_ALLOW_UNAUTHED_ENV] === "true";

  const allowed =
    devHatch ||
    (!!user && (isAdmin(user) || TENDER_WATCH_DEPARTMENTS.some((slug) => canAccess(user, slug))));

  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  // Keep the caller's ORIGINAL string against each locality, so the client can match results
  // back to its cards without re-implementing the parser and risking the two disagreeing.
  const byOriginal = new Map<string, Locality>();
  for (const raw of parsed.data.locations) {
    const locality = parseLocality(raw);
    if (locality) byOriginal.set(raw, locality);
  }

  if (byOriginal.size === 0) {
    return NextResponse.json({ ok: true, results: {} });
  }

  const matches = await findOpportunitiesIn([...byOriginal.values()]);
  const byKey = new Map(matches.map((m) => [`${m.locality.suburb}|${m.locality.state}`, m]));

  const results: Record<string, { suburb: string; state: string; opportunities: unknown[] }> = {};
  for (const [original, locality] of byOriginal) {
    const match = byKey.get(`${locality.suburb}|${locality.state}`);
    results[original] = {
      suburb: locality.suburb,
      state: locality.state,
      opportunities: match?.opportunities ?? [],
    };
  }

  return NextResponse.json({ ok: true, results });
}
