/**
 * Re-parse the stored bulletins and correct the link on every TenderSearch item.
 *
 *   npm run repair:tender-links -- --dry-run     (default — prints, changes nothing)
 *   npm run repair:tender-links -- --apply
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────
 *
 * The extractor found ONE "Web Document Location" per bulletin and stamped it on every
 * notice in it, on a comment claiming a bulletin's notices all share a subscriber token.
 * That was read off a two-notice bulletin where they happened to match. Real bulletins carry
 * a distinct token per notice, so most items linked to somebody else's tender — reported
 * from the review queue when the Wellington Shire item opened the wrong notice.
 *
 * The parser is fixed, but rows already stored keep the wrong link until their bulletin is
 * re-read, and the lookback window is three days — so most of them never would be. This is
 * the replay that `tender_scan_runs.raw_payload` exists for: the evidence was written down
 * BEFORE it was parsed, precisely so a parser fix could be applied to it afterwards.
 *
 * ── What it will and will not touch ──────────────────────────────────────────────────────
 *
 * ONLY `url`, and only where the stored value differs from what the fixed parser produces.
 * Never relevance, never the model's output, never forwarded_at or status — re-deciding a
 * tender somebody already actioned is exactly the failure `tender_upsert_item`'s narrow
 * `do update` clause exists to prevent.
 *
 * Rows whose `external_ref` predates the extractor (`email:tendersearch.com.au:<hash>`,
 * from the days a bulletin was split on its anchor links) cannot be matched to a notice and
 * are REPORTED, not guessed at. Their titles are tracking URLs and their excerpts are whole
 * bulletins; a link repair would not make them right.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { scriptDb } from "./_db";
import { extractTenderSearch } from "../lib/tenders/sources/extract/tendersearch";
import type { ExtractSource } from "../lib/tenders/sources/extract/types";

const SOURCE = "email:tendersearch.com.au";
const apply = process.argv.includes("--apply");

type RunRow = { started_at: string; raw_payload: unknown };
type StoredMessage = { from?: unknown; subject?: unknown; body?: unknown; receivedDateTime?: unknown };

/** The stored payload keeps Graph's shape loosely; read it defensively. */
function messagesOf(payload: unknown): ExtractSource[] {
  const list = (payload as { messages?: unknown })?.messages;
  if (!Array.isArray(list)) return [];
  return list.flatMap((m: StoredMessage) => {
    if (!m || typeof m !== "object") return [];
    const body = m.body;
    const html =
      typeof body === "string" ? body : typeof (body as { content?: unknown })?.content === "string" ? ((body as { content: string }).content) : "";
    if (!html) return [];
    return [
      {
        from: typeof m.from === "string" ? m.from : null,
        subject: typeof m.subject === "string" ? m.subject : null,
        html,
        receivedDateTime: typeof m.receivedDateTime === "string" ? m.receivedDateTime : null,
      },
    ];
  });
}

async function main() {
  const db = scriptDb();

  const { data: runs, error: runError } = await db
    .from("tender_scan_runs")
    .select("started_at, raw_payload")
    .eq("source_slug", SOURCE)
    .not("raw_payload", "is", null)
    .order("started_at", { ascending: true }); // oldest first, so the NEWEST bulletin wins
  if (runError) throw new Error(runError.message);

  // external_ref -> the link the fixed parser gives it. A tender listed in several bulletins
  // carries a different token in each; the newest is the one still worth clicking.
  const links = new Map<string, string>();
  let notices = 0;
  for (const run of (runs ?? []) as RunRow[]) {
    for (const message of messagesOf(run.raw_payload)) {
      for (const n of extractTenderSearch(message) ?? []) {
        notices++;
        if (n.url) links.set(n.externalRef, n.url);
      }
    }
  }
  console.log(`${runs?.length ?? 0} stored runs · ${notices} notices re-parsed · ${links.size} distinct references\n`);

  const { data: items, error: itemError } = await db
    .from("tender_items")
    .select("id, external_ref, title, url, relevance, forwarded_at, status")
    .eq("source_slug", SOURCE);
  if (itemError) throw new Error(itemError.message);

  const rows = items ?? [];
  const legacy = rows.filter((r) => !(r.external_ref as string).startsWith("ts:"));
  const wrong = rows.filter((r) => {
    const ref = r.external_ref as string;
    const fixed = links.get(ref);
    return fixed && fixed !== r.url;
  });
  const unmatched = rows.filter((r) => (r.external_ref as string).startsWith("ts:") && !links.get(r.external_ref as string));

  console.log(`${rows.length} stored items`);
  console.log(`  ${wrong.length} with the WRONG link`);
  console.log(`  ${unmatched.length} keyed ts: but with no bulletin left in the archive`);
  console.log(`  ${legacy.length} predating the extractor — reported, never guessed at\n`);

  for (const r of wrong.slice(0, 12)) {
    console.log(`  ${r.external_ref}  ${String(r.title).slice(0, 56)}`);
    console.log(`     was ${String(r.url).slice(0, 84)}`);
    console.log(`     now ${links.get(r.external_ref as string)!.slice(0, 84)}`);
  }
  if (wrong.length > 12) console.log(`  … and ${wrong.length - 12} more`);

  // The ones a person is actually looking at right now.
  const pending = wrong.filter((r) => !r.forwarded_at && r.status !== "archived" && ["match", "maybe"].includes(r.relevance as string));
  console.log(`\n${pending.length} of those are in the review queue right now.`);

  if (!apply) {
    console.log("\n--dry-run: nothing written. Re-run with --apply.");
    return;
  }

  let done = 0;
  for (const r of wrong) {
    // ONLY the url. Anything else here would re-open a decision somebody already made.
    const { error } = await db
      .from("tender_items")
      .update({ url: links.get(r.external_ref as string) })
      .eq("id", r.id);
    if (error) {
      console.error(`  FAILED ${r.external_ref}: ${error.message}`);
      continue;
    }
    done++;
  }
  console.log(`\nCorrected ${done} of ${wrong.length} links.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
