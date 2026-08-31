/**
 * Source discovery + alarm opt-in checks, against the real database.
 *
 *   npm run check:sources
 *
 * Unlike check:tenders this needs .env.local and TOUCHES THE DATABASE. It creates two
 * source rows under `email:zztest-*.example` slugs and deletes them in a finally block.
 * It never touches a real source, and it writes no tender items.
 *
 * What it pins: a discovered source with the alarm off stays healthy however quiet it
 * gets. Without that, every one-off client invitation would read as 'critical' five nights
 * after it arrived, and the alarm meant to catch buy.nsw dropping us would be the thing
 * everyone has learned to scroll past.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
// mailboxConfigured() only checks presence, and nothing below calls Graph.
process.env.MS_GRAPH_TENANT_ID ||= "test";
process.env.MS_GRAPH_CLIENT_ID ||= "test";
process.env.MS_GRAPH_CLIENT_SECRET ||= "test";
process.env.TENDER_MAILBOX ||= "tenders@ausdilaps.com.au";

import { createAdminClient } from "../lib/supabase/admin";
import { loadEmailSources } from "../lib/tenders/sources/mailbox";
import { loadTenderSummary } from "../lib/tenders/summary";

let fails = 0;
const ok = (l: string, c: boolean, extra = "") => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"}  ${l}${extra ? ` — ${extra}` : ""}`); };

const QUIET = "email:zztest-quiet.example";
const PORTAL = "email:zztest-portal.example";

async function main() {
  const db = createAdminClient();
  try {
    // Rows exactly as discoverMailboxSources() would write them, both with 6 empty runs.
    await db.from("tender_sources").upsert([
      { slug: QUIET,  label: "zztest-quiet.example",  kind: "email", sender_domain: "zztest-quiet.example",
        auto_discovered: true, alert_on_quiet: false, is_trusted: false, parse_mode: "auto", consecutive_empty: 6 },
      { slug: PORTAL, label: "zztest-portal.example", kind: "email", sender_domain: "zztest-portal.example",
        auto_discovered: true, alert_on_quiet: true,  is_trusted: true,  parse_mode: "digest", consecutive_empty: 6 },
    ], { onConflict: "slug" });

    const s1 = await loadTenderSummary(true);
    const quiet  = s1.sources.find((s) => s.slug === QUIET)!;
    const portal = s1.sources.find((s) => s.slug === PORTAL)!;

    ok("a one-off sender with 6 empty runs stays healthy", quiet.health === "healthy", quiet.health);
    ok("...and an opted-in portal with 6 empty runs is critical", portal.health === "critical", portal.health);
    ok("discovered sources render as configured, not 'not configured'", quiet.configured === true);
    ok("row state reaches the UI", quiet.alertOnQuiet === false && portal.alertOnQuiet === true && portal.isTrusted === true);
    ok("sender domain surfaced", quiet.senderDomain === "zztest-quiet.example", String(quiet.senderDomain));
    ok("parse mode surfaced", portal.parseMode === "digest", portal.parseMode);

    // Flipping the toggle is the whole point — it must change the verdict.
    await db.from("tender_sources").update({ alert_on_quiet: true }).eq("slug", QUIET);
    const s2 = await loadTenderSummary(true);
    ok("turning the alert on makes the same row critical",
       s2.sources.find((s) => s.slug === QUIET)!.health === "critical");

    // Failures are never opt-in: a broken source is broken whoever owns it.
    await db.from("tender_sources").update({ alert_on_quiet: false, consecutive_failures: 2 }).eq("slug", QUIET);
    const s3 = await loadTenderSummary(true);
    ok("a FAILING source still reports, alert opt-out or not",
       s3.sources.find((s) => s.slug === QUIET)!.health === "failing");

    // loadEmailSources builds runnable definitions from the rows.
    const defs = await loadEmailSources(db);
    ok("email sources load from the database", defs.some((d) => d.slug === QUIET) && defs.some((d) => d.slug === PORTAL),
       defs.map((d) => d.slug).join(", "));
    ok("they report configured", defs.every((d) => d.configured() === true));

    // is_enabled=false must take a source out of the run entirely.
    await db.from("tender_sources").update({ is_enabled: false }).eq("slug", QUIET);
    ok("a disabled source is not run", !(await loadEmailSources(db)).some((d) => d.slug === QUIET));
  } finally {
    await db.from("tender_sources").delete().in("slug", [QUIET, PORTAL]);
    const { count } = await db.from("tender_sources").select("*", { count: "exact", head: true }).like("slug", "%zztest%");
    console.log(`\ncleanup: ${count ?? "?"} zztest rows left (want 0)`);
  }
  console.log(fails === 0 ? "All passed." : `${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}
main();
