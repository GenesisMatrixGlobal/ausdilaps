import { soqlQuery } from "@/lib/salesforce";

export { salesforceRecordUrl, salesforceSearchUrl } from "./salesforce-urls";

/**
 * "Have we already quoted this?" — checked against Salesforce before anyone spends time on it.
 *
 * The expensive mistake this prevents is not a bad tender; it is a GOOD tender that somebody
 * chases for an afternoon before discovering the job is already an open opportunity someone
 * else is following up. Verified the day this was written: the highest-confidence item in the
 * queue (Seymour Whyte, Muswellbrook Bypass, 0.95) is the same job as PRE OPT-36786 and
 * PRE OPT-36647, both in Follow Up.
 *
 * ── Why SUBURB and state, not the street address ─────────────────────────────────────────
 *
 * The two sides do not describe a place the same way, and no amount of string cleverness
 * makes them. A tender notice gives a locality — "GOONDIWINDI QLD", "NORTH RICHMOND, NSW" —
 * because at tender stage the work often spans a corridor, a precinct or a whole council
 * area. An Opportunity carries a street address, because by then someone has been to site.
 * Matching street-to-street would report almost nothing and hide every real duplicate.
 *
 * So the suburb is the join, and the ANSWER IS A SHORTLIST FOR A HUMAN, never a verdict. The
 * card says "3 opportunities in Muswellbrook NSW" and shows them; a person decides in two
 * seconds whether it is the same job. Trying to decide that automatically would produce
 * exactly the confident-but-wrong call that costs more than the check saves.
 *
 * ── Cost ─────────────────────────────────────────────────────────────────────────────────
 *
 * ONE SOQL query for the whole queue, not one per card: the suburbs are collected, deduped
 * and sent as a single OR'd filter. Salesforce charges nothing per query (only a daily API
 * request allowance, which this uses one of), so this is free and adds no Anthropic spend.
 */

/** A suburb as a tender notice states it, normalised enough to put in a WHERE clause. */
export type Locality = { suburb: string; state: string };

export type OpportunityMatch = {
  id: string;
  name: string;
  stage: string;
  /** True when the opportunity is still live — the ones that actually mean "don't chase". */
  open: boolean;
  street: string | null;
  createdAt: string;
};

export type LocalityMatches = { locality: Locality; opportunities: OpportunityMatch[] };

/** Stage names that mean the opportunity is finished. Anything else is live work. */
const CLOSED_STAGES = new Set(["Closed Won", "Closed Lost", "Closed", "Cancelled", "Canceled"]);

const AU_STATES = new Set(["NSW", "QLD", "VIC", "SA", "WA", "TAS", "NT", "ACT"]);

/**
 * Pull a suburb and state out of whatever the notice called the location.
 *
 * Real values, all handled: "GOONDIWINDI QLD" · "NORTH RICHMOND, NSW" ·
 * "LIVERPOOL, NSW, 2170, Australia" · "MELBOURNE VIC".
 *
 * Returns null rather than guessing. A wrong suburb does not fail loudly — it silently
 * reports "no matches" on a job we HAVE quoted, which is the one outcome this whole check
 * exists to prevent, so anything uncertain is better left unanswered.
 */
export function parseLocality(siteLocation: string | null | undefined): Locality | null {
  if (!siteLocation) return null;

  const parts = siteLocation
    .replace(/\bAustralia\b/gi, "")
    .split(/[,\n]/)
    .flatMap((p) => p.trim().split(/\s+/))
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  // The state is the last token that IS a state — not simply the last token, because a
  // postcode and "Australia" both routinely trail it.
  const stateIndex = parts.findLastIndex((p) => AU_STATES.has(p.toUpperCase()));
  if (stateIndex <= 0) return null;

  const suburb = parts
    .slice(0, stateIndex)
    .filter((p) => !/^\d{4}$/.test(p)) // a postcode before the state is still not the suburb
    .join(" ")
    .trim();

  if (!suburb || suburb.length < 3) return null;
  return { suburb: suburb.toUpperCase(), state: parts[stateIndex].toUpperCase() };
}

const escapeSoql = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

const key = (l: Locality) => `${l.suburb}|${l.state}`;

/**
 * Every opportunity in any of these localities, in ONE query.
 *
 * ⚠️ The filter is OR'd PAIRS, never `City IN (…) AND State IN (…)`. The cross product of
 * those two lists matches Kingston VIC against a Kingston QLD job — and there is a Kingston
 * in four states, so that is not a hypothetical.
 *
 * Never throws. A Salesforce outage must not take down the review queue: the cards simply
 * render without the check, which is where they were before this existed.
 */
export async function findOpportunitiesIn(localities: Locality[]): Promise<LocalityMatches[]> {
  const unique = new Map(localities.map((l) => [key(l), l]));
  if (unique.size === 0) return [];

  const clauses = [...unique.values()]
    .map(
      (l) =>
        `(Site_Address__City__s = '${escapeSoql(l.suburb)}' AND Site_Address__StateCode__s = '${escapeSoql(l.state)}')`
    )
    .join(" OR ");

  try {
    const rows = await soqlQuery<{
      Id: string;
      Name: string;
      StageName: string;
      CreatedDate: string;
      Site_Address__Street__s: string | null;
      Site_Address__City__s: string | null;
      Site_Address__StateCode__s: string | null;
    }>(
      `SELECT Id, Name, StageName, CreatedDate, Site_Address__Street__s, Site_Address__City__s, Site_Address__StateCode__s
       FROM Opportunity
       WHERE ${clauses}
       ORDER BY CreatedDate DESC
       LIMIT 400`
    );

    const byLocality = new Map<string, OpportunityMatch[]>();
    for (const row of rows) {
      const k = `${(row.Site_Address__City__s ?? "").toUpperCase()}|${(row.Site_Address__StateCode__s ?? "").toUpperCase()}`;
      if (!unique.has(k)) continue;
      const list = byLocality.get(k) ?? [];
      list.push({
        id: row.Id,
        name: row.Name,
        stage: row.StageName,
        open: !CLOSED_STAGES.has(row.StageName),
        street: row.Site_Address__Street__s,
        createdAt: row.CreatedDate,
      });
      byLocality.set(k, list);
    }

    return [...unique.entries()].map(([k, locality]) => ({
      locality,
      // Open ones first: a Closed Lost from 2023 is context, an open Follow Up is a reason
      // to stop and ring someone.
      opportunities: (byLocality.get(k) ?? []).sort(
        (a, b) => Number(b.open) - Number(a.open) || b.createdAt.localeCompare(a.createdAt)
      ),
    }));
  } catch (e) {
    console.error("[tenders] Salesforce duplicate check failed:", (e as Error).message);
    return [];
  }
}
