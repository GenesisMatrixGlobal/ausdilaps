/**
 * Does the dashboard agree with the database?
 *
 *   npm run check:summary
 *
 * READ-ONLY against the live project (there is no dev database — see CLAUDE.md). No writes,
 * no classification, no Anthropic calls, no cost.
 *
 * This exists because of a specific bug: the page reported "329 scanned, 0 matches" directly
 * above a list of sixteen matches. Five counters on tender_scan_runs were declared in the
 * schema and never written by any code, and the funnel summed them; meanwhile the item list
 * ran on a different window again. Four scopes on one page, three of them unlabelled.
 *
 * So the assertion that matters is not "the number is 24" — data changes nightly and a test
 * pinned to today's rows is a test that gets deleted. It is that every figure the page shows
 * can be reproduced by counting rows directly, in the same window. Two ways of getting the
 * same number, which is the only way to catch one of them silently going stale again.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "../lib/supabase/admin";
import { WINDOW_DAYS } from "../lib/tenders/config";
import { loadTenderSummary } from "../lib/tenders/summary";

let fails = 0;
const ok = (pass: boolean, label: string, detail = "") => {
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
  const summary = await loadTenderSummary(true);
  if (summary.unavailable) {
    console.error(`Cannot reach the tender tables: ${summary.unavailable}`);
    process.exit(1);
  }

  const db = createAdminClient();
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const countWhere = async (apply: (b: any) => any): Promise<number> => {
    const { count } = await apply(
      db.from("tender_items").select("id", { count: "exact", head: true }).gte("created_at", since)
    );
    return count ?? 0;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  console.log(`window ${summary.windowDays}d · truncated ${summary.truncated}`);
  console.log(`funnel ${JSON.stringify(summary.funnel)}\n`);

  ok(!summary.truncated, "the item list is not truncated", `${summary.items.length} rows`);

  const f = summary.funnel;
  ok(f.matched === (await countWhere((b) => b.eq("relevance", "match"))), "funnel.matched == row count", `${f.matched}`);
  ok(f.review === (await countWhere((b) => b.eq("relevance", "maybe"))), "funnel.review == row count", `${f.review}`);
  ok(
    f.classified === (await countWhere((b) => b.eq("classified_by", "anthropic"))),
    "funnel.classified == row count",
    `${f.classified}`
  );
  ok(
    f.prefiltered === (await countWhere((b) => b.eq("classified_by", "prefilter"))),
    "funnel.prefiltered == row count",
    `${f.prefiltered}`
  );
  ok(
    f.sent === (await countWhere((b) => b.not("forwarded_at", "is", null))),
    "funnel.sent == row count",
    `${f.sent}`
  );

  // THE regression. The tile and the list it sits above must never disagree again.
  const listed = summary.items.filter((i) => i.relevance === "match").length;
  ok(f.matched === listed, "the funnel agrees with the list on screen", `${f.matched} vs ${listed}`);

  // Grouping must never lose a row — it is a display concern, not deduplication.
  const grouped = summary.groups.reduce((n, g) => n + g.count, 0);
  ok(grouped === f.matched + f.review, "every match/maybe row lands in exactly one group", `${grouped}`);
  ok(
    summary.stats.open === summary.groups.filter((g) => g.state === "queue").length,
    "the headline tile equals the number of cards"
  );
  ok(!summary.groups.some((g) => /^https?:\/\//.test(g.title)), "no opportunity is titled with a raw URL");

  const queue = summary.groups.filter((g) => g.state === "queue");
  console.log(`\n${queue.length} opportunities waiting, from ${grouped} stored rows:`);
  for (const g of [...queue].sort((a, b) => (a.lead.closesAt ?? "9") .localeCompare(b.lead.closesAt ?? "9")))
    console.log(
      `  ${g.count > 1 ? `x${String(g.count).padEnd(2)}` : "   "} ${g.lead.closesAt?.slice(0, 10) ?? "no date   "}  ${g.title.slice(0, 62)}`
    );

  console.log(fails === 0 ? "\nAll passed." : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
