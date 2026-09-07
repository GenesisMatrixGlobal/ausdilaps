import { groupItems, groupKey } from "@/lib/tenders/group";
import { readFileSync } from "node:fs";

type Row = { id: string; title: string; closes_at: string | null; confidence: number | null; created_at: string; relevance: string; source_slug: string };
const all: Row[] = JSON.parse(readFileSync("/tmp/items.json", "utf8"));
const matches = all.filter((r) => r.relevance === "match");

let fail = 0;
const ok = (p: boolean, label: string, detail = "") => { if (!p) fail++; console.log(`${p ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); };

const groups = groupItems(matches);
ok(groups.length === 15, "24 match rows collapse to 15 groups", `got ${groups.length}`);

const total = groups.reduce((n, g) => n + g.count, 0);
ok(total === matches.length, "no row is dropped", `${total} vs ${matches.length}`);

const ids = new Set(groups.flatMap((g) => g.members.map((m) => m.id)));
ok(ids.size === matches.length, "every id appears exactly once");

const musw = groups.find((g) => g.lead.title.includes("Muswellbrook"));
ok(musw?.count === 5, "Muswellbrook is one group of 5", `got ${musw?.count}`);
const srcs = new Set(musw?.members.map((m) => m.source_slug));
ok(srcs.size === 2, "…spanning 2 sources", [...srcs].join(", "));
ok(musw?.lead.confidence === 0.95, "…led by the 0.95 copy", String(musw?.lead.confidence));

// A missing close date must never match a real one.
ok(groupKey({ id: "a", title: "Dilapidation Survey", closes_at: null })
   !== groupKey({ id: "b", title: "Dilapidation Survey", closes_at: "2026-09-09T00:00:00+00:00" }),
   "null close date does not match a real one");
// Same day, different timezone rendering, must match.
ok(groupKey({ id: "a", title: "X Survey", closes_at: "2026-09-09T00:00:00+00:00" })
   === groupKey({ id: "b", title: "X Survey", closes_at: "2026-09-09T14:00:00+10:00" }),
   "same closing date matches across timestamp formats");
// Dash style must not split a group.
ok(groupKey({ id: "a", title: "Dilapidation Survey - Properties", closes_at: null })
   === groupKey({ id: "b", title: "Dilapidation Survey — Properties", closes_at: null }),
   "en dash and hyphen group together");
// The tender reference must still separate two jobs.
ok(groupKey({ id: "a", title: "126379 - Dilapidation Survey", closes_at: null })
   !== groupKey({ id: "b", title: "126380 - Dilapidation Survey", closes_at: null }),
   "different tender refs stay separate");

console.log("\n15 groups:");
for (const g of groups.sort((a, b) => b.count - a.count))
  console.log(`  x${g.count}  ${(g.lead.title || "").slice(0, 58)}`);

console.log(fail === 0 ? "\nAll grouping checks passed." : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
