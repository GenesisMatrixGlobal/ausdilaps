/**
 * Mailbox parsing + parse-mode detection checks.
 *
 *   npm run check:tenders
 *
 * No tenant, no network, no database — pure functions over synthetic Graph messages, so
 * this runs anywhere and is the right place to pin the parsers as portals change formats.
 *
 * Two assertions here are load-bearing and should not be relaxed:
 *
 *   "all keyed distinctly"  — caught a dedupe collision on its first run: buy.nsw's
 *                             RFT-2026-001 and RFT-2026-002 both reduced to `atm:RFT2026`,
 *                             so the second tender was discarded as a duplicate of the
 *                             first. Invisible in production: no error, no empty result.
 *
 *   "misread single ..."    — parse-mode detection leans digest on purpose, because a
 *                             30-tender digest read as one email loses 29 silently. That
 *                             bias is only safe while the zero-link fallback holds.
 *
 * When a portal changes format, add a real sample here first, watch it fail, then fix.
 */

import { parseMessages, type GraphMessage, type EmailSource } from "../lib/tenders/sources/mailbox";
import { detectParseMode, contentLinks, senderDomain, slugForDomain } from "../lib/tenders/senders";

let fails = 0;
const ok = (l: string, c: boolean, extra = "") => {
  if (!c) fails++;
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${extra ? ` — ${extra}` : ""}`);
};

/** A source row as discovery would have created it. */
const source = (domain: string, over: Partial<EmailSource> = {}): EmailSource => ({
  slug: slugForDomain(domain),
  label: domain,
  senderDomain: domain,
  parseMode: "auto",
  isTrusted: false,
  ...over,
});

const msg = (o: { from: string; subject?: string; html?: string; text?: string; hasAttachments?: boolean }): GraphMessage => ({
  id: `id-${o.subject ?? "x"}`,
  internetMessageId: `<${o.subject ?? "x"}@test>`,
  subject: o.subject ?? "(no subject)",
  from: { emailAddress: { address: o.from } },
  receivedDateTime: "2026-08-27T02:00:00Z",
  hasAttachments: o.hasAttachments ?? false,
  body: o.html ? { contentType: "html", content: o.html } : { contentType: "text", content: o.text ?? "" },
  webLink: "https://outlook.office365.com/x",
});

// ── A realistic digest: 3 tenders plus the usual footer noise ───────────────────
const digestHtml = `
<html><body>
  <p>Your daily opportunities</p>
  <a href="https://buy.nsw.gov.au/opportunity/RFT-2026-001">Dilapidation Survey Services — Sydney Metro</a>
  <a href="https://buy.nsw.gov.au/opportunity/RFT-2026-002">Structural Condition Assessment — Parramatta Light Rail</a>
  <a href="https://buy.nsw.gov.au/tender/EOI-2026-099">EOI: Pre-condition surveys, M6 Stage 1</a>
  <a href="https://buy.nsw.gov.au/unsubscribe?u=123">Unsubscribe</a>
  <a href="https://twitter.com/buynsw">Follow us</a>
  <a href="https://buy.nsw.gov.au/">Home</a>
</body></html>`;

const buynsw = source("buy.nsw.gov.au", { isTrusted: true });
const items = parseMessages([msg({ from: "noreply@buy.nsw.gov.au", subject: "Daily digest", html: digestHtml })], buynsw);

console.log(`\n--- digest -> ${items.length} items ---`);
for (const i of items) console.log(`    ${i.externalRef.padEnd(22)} ${i.title.slice(0, 50)}`);

ok("detected as a digest", detectParseMode(digestHtml, "buy.nsw.gov.au") === "digest");
ok("one item per tender link", items.length === 3, `${items.length}`);
ok("unsubscribe, social and homepage links excluded",
   !items.some((i) => /unsubscribe|twitter/.test(i.url ?? "") || i.url === "https://buy.nsw.gov.au/"));
ok("anchor text becomes the title", items[0].title.includes("Dilapidation Survey Services"), items[0].title);
ok("all keyed distinctly", new Set(items.map((i) => i.externalRef)).size === 3,
   `only ${new Set(items.map((i) => i.externalRef)).size} distinct keys — a tender would be swallowed`);
ok("trust comes from the row", items.every((i) => i.senderTrusted === true));

// Reordering a digest must not move the keys — portals reorder between sends.
const reordered = digestHtml.split("\n").reverse().join("\n");
const items2 = parseMessages([msg({ from: "alerts@buy.nsw.gov.au", subject: "Daily digest", html: reordered })], buynsw);
ok("keys are stable when the digest reorders",
   JSON.stringify(items.map((i) => i.externalRef).sort()) === JSON.stringify(items2.map((i) => i.externalRef).sort()));

// ── Detection, both directions ─────────────────────────────────────────────────
const inviteHtml = `<p>Hi team, can you price the attached dilapidation scope?</p>
  <p>Regards,<br>Sarah</p><a href="https://bigconstructionco.com.au">bigconstructionco.com.au</a>`;
ok("a one-off invite with only a signature link reads as single",
   detectParseMode(inviteHtml, "bigconstructionco.com.au") === "single",
   `links: ${JSON.stringify(contentLinks(inviteHtml, "bigconstructionco.com.au"))}`);

const invite = parseMessages(
  [msg({ from: "sarah.tan@bigconstructionco.com.au", subject: "Dilapidation pricing — Northern Rd", html: inviteHtml, hasAttachments: true })],
  source("bigconstructionco.com.au")
);
ok("invite yields exactly one item", invite.length === 1, `${invite.length}`);
ok("attachment-with-no-body is flagged for the classifier", invite[0].excerpt.includes("probably in the attachment"));
ok("an undiscovered sender is not trusted by default", invite[0].senderTrusted === false);

// THE SAFETY NET. Detection leans digest, so a single invitation can be misread as one.
// That must cost nothing: the zero-link fallback has to turn it back into one item.
const misread = parseMessages(
  [msg({ from: "sarah.tan@bigconstructionco.com.au", subject: "Pricing request", text: "Please see attached." })],
  source("bigconstructionco.com.au", { parseMode: "digest" })
);
ok("misread single falls back to one whole-message item, losing nothing", misread.length === 1, `${misread.length}`);
ok("...and says why in the excerpt", misread[0].excerpt.includes("no tender links were found"));

// An aggregator links out to other portals' domains — those still count as content.
const aggregator = `<a href="https://tenders.nsw.gov.au/rft/12345/view">Bridge condition survey</a>
  <a href="https://qtenders.hpw.qld.gov.au/tender/display/9911">Culvert inspection panel</a>`;
ok("aggregator links to other domains still detect as a digest",
   detectParseMode(aggregator, "tendersearch.com.au") === "digest",
   JSON.stringify(contentLinks(aggregator, "tendersearch.com.au")));

// ── Routing is now purely by domain ────────────────────────────────────────────
const mixed = [
  msg({ from: "noreply@buy.nsw.gov.au", subject: "A", html: digestHtml }),
  msg({ from: "pm@somecouncil.nsw.gov.au", subject: "B", text: "Please quote." }),
];
ok("a source only takes its own domain's mail", parseMessages(mixed, source("somecouncil.nsw.gov.au")).length === 1);
ok("...and ignores everything else", parseMessages(mixed, source("nobody.example")).length === 0);

for (const [from, expect] of [
  ["noreply@buy.nsw.gov.au", "buy.nsw.gov.au"],
  ["Name Surname <a.b@Tendersearch.com.au>", "tendersearch.com.au"],
  ["broken-no-at-sign", null],
] as [string, string | null][]) {
  ok(`domain of ${from.slice(0, 34).padEnd(34)} -> ${expect}`, senderDomain(from) === expect, String(senderDomain(from)));
}

console.log(fails === 0 ? "\nAll passed." : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
