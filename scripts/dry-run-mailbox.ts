/**
 * Parse the real mailbox WITHOUT touching the database or the classifier.
 *
 *   npm run dryrun:mailbox
 *
 * Shows what each real email would become: which source claims it, whether it is read as a
 * digest or a single tender, and the items it produces. This is where a digest parser is
 * proven right — an email listing eight tenders that yields one item is the silent failure
 * this whole design is shaped to avoid, and it is invisible once the rows are stored.
 *
 * Read-only. No writes, no Anthropic calls, no cost.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchMailboxMessages, parseMessages, type EmailSource } from "../lib/tenders/sources/mailbox";
import { senderDomain, slugForDomain, resolveParseMode, contentLinks } from "../lib/tenders/senders";

const from = (m: { from?: { emailAddress?: { address?: string } } }) =>
  m.from?.emailAddress?.address ?? null;

async function main() {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const messages = await fetchMailboxMessages(since);
  console.log(`${messages.length} messages in the last 7 days\n`);

  const domains = [...new Set(messages.map((m) => senderDomain(from(m))).filter(Boolean))] as string[];
  let totalItems = 0;

  for (const domain of domains) {
    const source: EmailSource = {
      slug: slugForDomain(domain),
      label: domain,
      senderDomain: domain,
      parseMode: "auto",
      isTrusted: false,
    };
    const mine = messages.filter((m) => senderDomain(from(m)) === domain);
    const items = parseMessages(messages, source);
    totalItems += items.length;

    console.log(`── ${source.slug}  (${mine.length} email${mine.length === 1 ? "" : "s"} -> ${items.length} item${items.length === 1 ? "" : "s"})`);
    for (const m of mine) {
      const html = m.body?.contentType?.toLowerCase() === "html" ? (m.body.content ?? "") : "";
      const mode = resolveParseMode("auto", html, domain);
      const links = contentLinks(html, domain).length;
      console.log(`   [${mode}${mode === "digest" ? `, ${links} links` : ""}]  ${(m.subject ?? "(no subject)").slice(0, 66)}`);
    }
    for (const i of items.slice(0, 6)) console.log(`      -> ${i.title.slice(0, 72)}`);
    if (items.length > 6) console.log(`      -> ... and ${items.length - 6} more`);
    console.log();
  }

  console.log(`TOTAL: ${messages.length} emails -> ${totalItems} tender items`);
  console.log("\nSanity check: open a digest above in Outlook and count the tenders in it.");
  console.log("If the count doesn't match, the parser is losing them and we fix it now.");
}
main().catch((e) => { console.error(e); process.exit(1); });
