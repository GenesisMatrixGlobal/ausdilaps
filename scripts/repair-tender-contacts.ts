/**
 * Re-clean `agency` / `contact` on stored TenderSearch items.
 *
 *   npm run repair:tender-contacts             (dry run — prints, changes nothing)
 *   npm run repair:tender-contacts -- --apply
 *
 * ── Why ──────────────────────────────────────────────────────────────────────────────────
 *
 * `cleanContact` stripped the "GovDept" marker with a ^-anchored regex, so it only fired when
 * the marker came first. TenderSearch usually puts the contact TYPE in front of it, and the
 * result reached the review queue verbatim:
 *
 *     /Technical GovDept Wellington Shire Council Ph: 1800 377 628
 *
 * printed as both the agency AND the contact on the card. The parser is fixed, but stored
 * rows keep the old text until something rewrites it.
 *
 * ── Why not replay the bulletins ─────────────────────────────────────────────────────────
 *
 * repair-tender-links.ts replays `raw_payload` because a LINK cannot be recovered from the
 * stored row — it had to come back out of the original HTML. This does not: the clean is a
 * pure function of the string already in the column, so it runs over the rows directly and
 * therefore also fixes rows whose bulletin has aged out of the archive.
 *
 * ONLY those two text fields, and only where the cleaned value differs. Never relevance,
 * never the model's output, never forwarded_at or status.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { scriptDb } from "./_db";
import { cleanContactValue } from "../lib/tenders/sources/extract/tendersearch";

const SOURCE = "email:tendersearch.com.au";
const apply = process.argv.includes("--apply");

async function main() {
  const db = scriptDb();
  const { data, error } = await db
    .from("tender_items")
    .select("id, title, agency, contact")
    .eq("source_slug", SOURCE);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const changes = rows.flatMap((r) => {
    const agency = cleanContactValue((r.agency as string | null) ?? null);
    const contact = cleanContactValue((r.contact as string | null) ?? null);
    if (agency === r.agency && contact === r.contact) return [];
    return [{ id: r.id as string, from: (r.agency ?? r.contact) as string, agency, contact }];
  });

  console.log(`${rows.length} stored items · ${changes.length} need cleaning\n`);
  for (const c of changes.slice(0, 12)) {
    console.log(`  was ${c.from}`);
    console.log(`  now ${c.agency ?? "(blank)"}\n`);
  }
  if (changes.length > 12) console.log(`  … and ${changes.length - 12} more\n`);

  if (!apply) {
    console.log("--dry-run: nothing written. Re-run with --apply.");
    return;
  }

  let done = 0;
  for (const c of changes) {
    const { error: e } = await db
      .from("tender_items")
      .update({ agency: c.agency, contact: c.contact })
      .eq("id", c.id);
    if (e) {
      console.error(`  FAILED ${c.id}: ${e.message}`);
      continue;
    }
    done++;
  }
  console.log(`Cleaned ${done} of ${changes.length}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
