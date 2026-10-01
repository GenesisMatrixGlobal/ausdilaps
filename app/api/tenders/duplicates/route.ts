import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccess, getStaffUser, isAdmin } from "@/lib/auth/session";
import { TENDER_WATCH_ALLOW_UNAUTHED_ENV, TENDER_WATCH_DEPARTMENTS } from "@/lib/tenders/config";
import {
  findOpportunitiesIn,
  findOpportunitiesNamed,
  parseLocality,
  projectPhrases,
  type Locality,
  type OpportunityMatch,
} from "@/lib/tenders/salesforce-match";

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

/**
 * One probe per OPPORTUNITY, keyed by the caller's group key.
 *
 * It used to take bare location strings and key the answer by the string, which meant a
 * tender with no location could not be asked about at all — and three of seven live cards
 * were in that position, showing no Salesforce line where the truth was "not checked".
 * Sending the title and agency too lets the route fall back to a project-name match.
 */
const Body = z.object({
  probes: z
    .array(
      z.object({
        key: z.string().min(1).max(200),
        location: z.string().trim().max(200).nullable().optional(),
        title: z.string().trim().max(300).nullable().optional(),
        agency: z.string().trim().max(300).nullable().optional(),
      })
    )
    .min(1)
    .max(100),
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

  // Decide each probe's basis first, so both Salesforce queries can be batched across the
  // whole queue — one for the localities, one for the project names.
  type Plan =
    | { basis: "locality"; label: string; locality: Locality }
    | { basis: "project"; label: string; phrases: string[] };

  const plans = new Map<string, Plan>();
  for (const probe of parsed.data.probes) {
    const locality = parseLocality(probe.location ?? null);
    if (locality) {
      plans.set(probe.key, {
        basis: "locality",
        label: `${locality.suburb} ${locality.state}`,
        locality,
      });
      continue;
    }
    // No usable suburb — fall back to what the job is CALLED.
    const phrases = projectPhrases(probe.title ?? null, probe.agency ?? null);
    if (phrases.length > 0) {
      plans.set(probe.key, { basis: "project", label: phrases.join(" / "), phrases });
    }
    // Neither: no entry, and the card shows no line. Saying "nothing found" would be a
    // claim we have not earned.
  }

  if (plans.size === 0) {
    return NextResponse.json({ ok: true, results: {} });
  }

  const localities = [...plans.values()].flatMap((p) => (p.basis === "locality" ? [p.locality] : []));
  const phrases = [...plans.values()].flatMap((p) => (p.basis === "project" ? p.phrases : []));

  const [localityMatches, namedMatches] = await Promise.all([
    localities.length > 0 ? findOpportunitiesIn(localities) : Promise.resolve([]),
    findOpportunitiesNamed(phrases),
  ]);
  const byLocality = new Map(localityMatches.map((m) => [`${m.locality.suburb}|${m.locality.state}`, m]));

  const results: Record<
    string,
    { label: string; basis: "locality" | "project"; opportunities: OpportunityMatch[] }
  > = {};
  for (const [key, plan] of plans) {
    if (plan.basis === "locality") {
      const match = byLocality.get(`${plan.locality.suburb}|${plan.locality.state}`);
      results[key] = { label: plan.label, basis: "locality", opportunities: match?.opportunities ?? [] };
    } else {
      // Deduped across phrases: "Fifteenth Avenue" and "Fifteenth Avenue Upgrade" both hit
      // the same opportunity, and listing it twice would read as two duplicates.
      const seen = new Set<string>();
      const opportunities = plan.phrases
        .flatMap((p) => namedMatches.get(p) ?? [])
        .filter((o) => !seen.has(o.id) && seen.add(o.id))
        .sort((a, b) => Number(b.open) - Number(a.open) || b.createdAt.localeCompare(a.createdAt));
      results[key] = { label: plan.label, basis: "project", opportunities };
    }
  }

  return NextResponse.json({ ok: true, results });
}
