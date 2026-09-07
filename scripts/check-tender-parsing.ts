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
import { displayTitle, groupItems, groupKey } from "../lib/tenders/group";
import { extractNotices, extractorFor } from "../lib/tenders/sources/extract";
import type { ExtractSource } from "../lib/tenders/sources/extract/types";
import { parseDayMonthYear } from "../lib/tenders/sources/extract/date";
import { readFileSync } from "node:fs";

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

// ── The excerpt must be the EMAIL BODY, not the link's own text ────────────────
// Regression: destructuring `text` from the link shadowed the message body one line
// above, so every digest item's excerpt collapsed to its own title. The classifier then
// judged tenders on a dozen characters — no closing date, no agency, no description — and
// looked healthy doing it, because items were still produced with plausible titles.
{
  const marker = "Closing 21 Sept 2026. Buying agency Goulburn Valley Water.";
  const withBody = parseMessages(
    [msg({ from: "noreply@tenders.vic.gov.au", subject: "New Tender Notifications",
      html:
        `<p>${marker}</p>` +
        `<a href="https://www.tenders.vic.gov.au/tender/view?id=1">Dilapidation Survey Services</a>` +
        `<a href="https://www.tenders.vic.gov.au/tender/view?id=2">Structural Condition Report</a>` })],
    source("tenders.vic.gov.au")
  );
  ok("digest items carry the email body as excerpt",
     withBody.length === 2 && withBody.every((i) => i.excerpt.includes("Goulburn Valley Water")),
     `${withBody.length} items, first excerpt ${withBody[0]?.excerpt.length} chars`);
  ok("excerpt is not merely the title", withBody.every((i) => i.excerpt !== i.title));
  ok("title still comes from the anchor text",
     withBody[0]?.title === "Dilapidation Survey Services", String(withBody[0]?.title));
}

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

// ── Grouping ───────────────────────────────────────────────────────────────────
//
// The same tender arrives up to five times. Grouping is what turns 41 stored rows into 12
// opportunities, and it runs at READ time so nothing is ever deleted — hence the
// "nothing is lost" assertion below, which is the one that must never be relaxed.
const g = (id: string, title: string, closes: string | null, agency: string | null = null, confidence = 0.8) =>
  ({ id, title, closesAt: closes, agency, confidence, createdAt: "2026-09-01T00:00:00Z" });

const reminders = [
  g("1", "Muswellbrook Bypass Project - Dilapidation Survey", null, "Seymour Whyte", 0.95),
  g("2", "Muswellbrook Bypass Project - Dilapidation Survey", null, "Seymour Whyte", 0.83),
  g("3", "Muswellbrook Bypass Project — Dilapidation Survey", null, "AusDilaps", 0.9),
];
const grouped = groupItems(reminders);
ok("three reminders of one job group into one", grouped.length === 1, `${grouped.length}`);
ok("...led by the most confident copy", grouped[0].lead.id === "1", grouped[0].lead.id);
ok("...and NOTHING IS LOST", grouped[0].members.length === 3, `${grouped[0].members.length}`);

ok("a different tender reference stays separate",
   groupKey(g("a", "126379 - Survey", null)) !== groupKey(g("b", "126380 - Survey", null)));
ok("the same closing date matches across timestamp formats",
   groupKey(g("a", "X", "2026-09-09T00:00:00+00:00")) === groupKey(g("b", "X", "2026-09-09T14:00:00+10:00")));
ok("a missing closing date never matches a real one",
   groupKey(g("a", "X", null)) !== groupKey(g("b", "X", "2026-09-09T00:00:00Z")));

// TenderSearch titles every row with its own tracking URL, so the title carries no identity
// and the key has to fall back to the agency — otherwise one job becomes eleven cards.
const urlTitled = [
  g("1", "https://link.tendersearch.com.au/token/AAA-111", "2026-09-17T00:00:00Z", "Queensland Health"),
  g("2", "https://link.tendersearch.com.au/token/BBB-222", "2026-09-17T00:00:00Z", "Queensland Health"),
];
ok("URL-titled rows group by agency + closing date", groupItems(urlTitled).length === 1);
ok("...but a different agency still separates them",
   groupItems([urlTitled[0], { ...urlTitled[1], agency: "City of Kingston" }]).length === 2);
// Without an agency there is nothing to key on, and collapsing them would merge unrelated
// tenders from unrelated portals into one card.
ok("URL-titled rows with NO agency do not all collapse together",
   groupItems([
     { ...urlTitled[0], agency: null },
     { ...urlTitled[1], agency: null },
   ]).length === 2);

ok("a URL title never reaches the screen",
   !displayTitle({ title: "https://link.tendersearch.com.au/token/AAA", agency: "Glenelg Shire Council",
                   summary: "Council seeks a condition assessment of a watertower. Contract 2026-27." })
     .startsWith("http"));
ok("...and a real title passes through untouched",
   displayTitle({ title: "Muswellbrook Bypass - Dilapidation Survey" }) === "Muswellbrook Bypass - Dilapidation Survey");

// ── Per-sender extraction ──────────────────────────────────────────────────────
//
// Fixtures are the REAL bulletins, lifted from tender_scan_runs.raw_payload with the
// subscriber tracking tokens redacted (the URL shape is preserved, so extraction is still
// exercised). This is the corpus the extractors were written against, and the reason a
// format change shows up here as a failing count rather than in production as silence.
const FIXTURES: ExtractSource[] = JSON.parse(
  readFileSync("lib/tenders/sources/extract/__fixtures__/messages.json", "utf8")
);
const domainOf = (m: ExtractSource) => (m.from ?? "").split("@").pop() ?? null;
const run = (m: ExtractSource) => extractNotices(m, domainOf(m));

ok("an extractor is registered for tendersearch and felix",
   !!extractorFor("tendersearch.com.au") && !!extractorFor("felix.net"));
ok("...and a subdomain resolves too", !!extractorFor("mail.felix.net"));
ok("...and an unknown portal has none, so it takes the generic path",
   extractorFor("buy.nsw.gov.au") === null);

const tsMsgs = FIXTURES.filter((m) => (m.from ?? "").includes("tendersearch"));
const tsNotices = tsMsgs.flatMap((m) => run(m) ?? []);
ok("5 TenderSearch bulletins yield 47 notices", tsNotices.length === 47, `${tsNotices.length}`);
ok("every notice has its own TS reference",
   new Set(tsNotices.map((n) => n.externalRef)).size === tsNotices.length);

// THE BUG. Every item in a bulletin used to carry the whole bulletin as its excerpt, so the
// classifier could not tell which of 14 notices it was judging. If this ever passes again
// with a shared excerpt, the titles go back to being tracking URLs.
ok("no two notices share an excerpt",
   new Set(tsNotices.map((n) => n.excerpt)).size === tsNotices.length,
   `${new Set(tsNotices.map((n) => n.excerpt)).size} distinct of ${tsNotices.length}`);
ok("no notice is titled with a URL", tsNotices.every((n) => !/^https?:/i.test(n.title)));
ok("every notice has a closing date", tsNotices.every((n) => !!n.closesAt));
ok("...parsed day-first", tsNotices.every((n) => /^\d{4}-\d{2}-\d{2}$/.test(n.closesAt!)));
ok("most notices have a location", tsNotices.filter((n) => n.siteLocation).length >= 30,
   `${tsNotices.filter((n) => n.siteLocation).length}/47`);
ok("TenderSearch's own 'NOT STATED' placeholder is not stored as an address",
   tsNotices.every((n) => !/not stated|as stated/i.test(n.siteLocation ?? "")));
ok("every notice names a contact", tsNotices.every((n) => !!n.contact));
ok("...with the 'GovDept' prefix stripped",
   tsNotices.every((n) => !/^GovDept/i.test(n.contact ?? "")));
ok("...and not running on into the contract number",
   tsNotices.every((n) => !/Contract No/i.test(n.contact ?? "")));

const fxMsgs = FIXTURES.filter((m) => (m.from ?? "").includes("felix"));
const fxNotices = fxMsgs.flatMap((m) => run(m) ?? []);
ok("6 Felix messages yield 5 notices (the guest-access notice is not a tender)",
   fxNotices.length === 5, `${fxNotices.length}`);
// 5 notices, 3 references: the new-RFQ email and BOTH reminders for #126379 resolve to
// `felix:126379`, so the unique index on (source_slug, external_ref) collapses all three
// into one row. Previously each reminder carried a fresh tracking URL, keyed differently,
// and arrived as another opportunity — which is what group.ts had to approximate around.
ok("the three messages about request #126379 share one reference",
   new Set(fxNotices.map((n) => n.externalRef)).size === 3,
   `${new Set(fxNotices.map((n) => n.externalRef)).size} distinct of ${fxNotices.length}`);
ok("...and it is the request number, not a hash of a link",
   fxNotices.filter((n) => n.externalRef === "felix:126379").length === 3);
ok("a named person is captured as the contact where Felix gives one",
   fxNotices.some((n) => n.contact === "Justin Van Niekerk"));
ok("the client is captured, not a sentence fragment",
   fxNotices.some((n) => n.agency === "Seymour Whyte") && fxNotices.some((n) => n.agency === "Fulton Hogan"),
   fxNotices.map((n) => n.agency).join(" | "));
ok("the guest-access notice returns null and falls back",
   run(fxMsgs.find((m) => /Guest user/i.test(m.subject ?? ""))!) === null);
ok("a Felix location is captured", fxNotices.filter((n) => n.siteLocation).length >= 3);

// Dates: day-first, and never a guess.
for (const [raw, expect] of [
  ["07-Oct-2026 04:00 PM", "2026-10-07"],
  ["14 September 2026", "2026-09-14"],
  ["09-Sep-2026 05:00 PM", "2026-09-09"],
  ["not a date", null],
  ["32-Oct-2026", null],
  ["07-Xxx-2026", null],
] as [string, string | null][]) {
  ok(`date ${raw.padEnd(22)} -> ${expect}`, parseDayMonthYear(raw) === expect, String(parseDayMonthYear(raw)));
}

console.log(fails === 0 ? "\nAll passed." : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
