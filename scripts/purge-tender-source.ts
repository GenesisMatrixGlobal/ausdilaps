/**
 * Delete every stored item for one or more email sources, so the next scan re-ingests them.
 *
 *   npm run purge:tenders -- email:tendersearch.com.au email:felix.net
 *   npm run purge:tenders -- --dry-run email:felix.net
 *
 * ── Why a purge rather than a re-parse ────────────────────────────────────────────────────
 *
 * Re-ingesting alone does nothing useful. `tender_upsert_item`'s `on conflict` refreshes only
 * source-owned fields and deliberately never touches `relevance`, so an existing row keeps
 * its old verdict forever — and the rows this is for were classified from an excerpt
 * containing an entire 14-notice bulletin, with a tracking URL as their title. Their
 * external_refs are changing too (`ts:967459` instead of a hash of a link), so the improved
 * parser would insert alongside them rather than replace them.
 *
 * ⚠️ THIS DELETES REAL ROWS FROM PRODUCTION. There is no dev database (see CLAUDE.md), so
 * this is always live data. Three guards:
 *
 *   - it refuses any slug that is not an existing `kind='email'` source, so a typo cannot
 *     match a wildcard or reach the RSS sources;
 *   - it refuses outright if any target row has been forwarded, because that row is part of
 *     a handoff someone has already acted on and deleting it would erase the only record;
 *   - `--dry-run` reports exactly what would go without touching anything.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "../lib/supabase/admin";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const slugs = args.filter((a) => !a.startsWith("--"));

if (slugs.length === 0) {
  console.error("Usage: npm run purge:tenders -- [--dry-run] <source-slug> [<source-slug>…]");
  console.error("   e.g. npm run purge:tenders -- email:tendersearch.com.au email:felix.net");
  process.exit(1);
}

async function main() {
  const db = createAdminClient();

  // Guard 1 — every slug must be a real email source.
  const { data: sources, error: sourceError } = await db
    .from("tender_sources")
    .select("slug, kind, label")
    .in("slug", slugs);
  if (sourceError) throw new Error(sourceError.message);

  const known = new Set((sources ?? []).filter((s) => s.kind === "email").map((s) => s.slug as string));
  const unknown = slugs.filter((s) => !known.has(s));
  if (unknown.length > 0) {
    console.error(`Not an existing email source: ${unknown.join(", ")}`);
    console.error("Existing email sources:");
    const { data: all } = await db.from("tender_sources").select("slug").eq("kind", "email").order("slug");
    for (const s of all ?? []) console.error(`  ${s.slug}`);
    process.exit(1);
  }

  const { data: rows, error } = await db
    .from("tender_items")
    .select("id, relevance, forwarded_at, status, title")
    .in("source_slug", slugs);
  if (error) throw new Error(error.message);

  const items = rows ?? [];
  if (items.length === 0) {
    console.log("Nothing stored for those sources. Done.");
    return;
  }

  const counts = items.reduce<Record<string, number>>((acc, r) => {
    const k = r.relevance as string;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`${items.length} item(s) across ${slugs.length} source(s):`);
  for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${k}`);
  }

  // Guard 2 — a forwarded row is part of a handoff somebody has acted on.
  const forwarded = items.filter((r) => r.forwarded_at !== null);
  if (forwarded.length > 0) {
    console.error(`\nREFUSING: ${forwarded.length} of these have already been sent to the team.`);
    console.error("Deleting them would erase the only record that the handoff happened.");
    for (const r of forwarded.slice(0, 5)) console.error(`  ${(r.title as string).slice(0, 70)}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing deleted.");
    return;
  }

  const { error: deleteError } = await db.from("tender_items").delete().in("source_slug", slugs);
  if (deleteError) throw new Error(deleteError.message);

  // The gone-quiet counters would otherwise read as though these sources had stopped
  // sending, and `alert_on_quiet` sources would start reporting critical.
  await db
    .from("tender_sources")
    .update({ consecutive_empty: 0, consecutive_failures: 0, last_error: null })
    .in("slug", slugs);

  console.log(`\nDeleted ${items.length} item(s). The next scan will re-ingest them.`);
  console.log("Run it now with the tool's “Run scan now” button, or wait for 5am.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
