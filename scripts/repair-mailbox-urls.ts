/**
 * Move mailbox deep links out of `tender_items.url`.
 *
 *   npm run repair:mailbox-urls             (dry run)
 *   npm run repair:mailbox-urls -- --apply
 *
 * `tender_items.url` means "a link the RECIPIENT can follow". `singleItem()` used to put
 * Graph's `webLink` there — a deep link into the tenders@ mailbox — and although that was
 * fixed at ingest, the rows written before it kept theirs. They surfaced in the first real
 * handoff email as "Open the notice → outlook.office365.com" on four of nine opportunities,
 * and they were the four best: the Muswellbrook Bypass survey, the Australia Avenue RFQ and
 * both Felix dilapidation surveys.
 *
 * The renderer now refuses these hosts anyway (lib/tenders/display.ts), so this is the second
 * half of the fix rather than the whole of it: it puts the data right, so the card, the email
 * and anything built later all agree without each having to remember the denylist.
 *
 * The link is PRESERVED in `mailbox_url` — it is how an admin finds the original email — and
 * only ever moved when that column is free. Nothing else is touched.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { scriptDb } from "./_db";
import { followableNoticeUrl } from "../lib/tenders/display";

const apply = process.argv.includes("--apply");

async function main() {
  const db = scriptDb();
  const { data, error } = await db
    .from("tender_items")
    .select("id, title, url, mailbox_url, relevance, forwarded_at, status")
    .not("url", "is", null);
  if (error) throw new Error(error.message);

  const bad = (data ?? []).filter((r) => followableNoticeUrl(r.url as string) === null);
  const inQueue = bad.filter(
    (r) => ["match", "maybe"].includes(r.relevance as string) && !r.forwarded_at && r.status !== "archived"
  );

  console.log(`${(data ?? []).length} items carry a url`);
  console.log(`${bad.length} of them cannot be opened by a recipient`);
  console.log(`${inQueue.length} of THOSE are in the review queue right now\n`);
  for (const r of bad.slice(0, 10)) {
    console.log(`  ${(r.title as string).slice(0, 56)}`);
    console.log(`     ${String(r.url).slice(0, 78)}`);
  }
  if (bad.length > 10) console.log(`  … and ${bad.length - 10} more`);

  if (!apply) {
    console.log("\n--dry-run: nothing written. Re-run with --apply.");
    return;
  }

  let done = 0;
  for (const r of bad) {
    // Keep the original where there is room for it; never overwrite a mailbox_url already set.
    const patch: Record<string, unknown> = { url: null };
    if (!r.mailbox_url) patch.mailbox_url = r.url;
    const { error: e } = await db.from("tender_items").update(patch).eq("id", r.id);
    if (e) {
      console.error(`  FAILED ${r.id}: ${e.message}`);
      continue;
    }
    done++;
  }
  console.log(`\nMoved ${done} of ${bad.length}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
