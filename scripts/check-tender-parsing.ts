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
import { displayTitle, groupItems, groupKey, MERGE_AT } from "../lib/tenders/group";
import { extractNotices, extractorFor } from "../lib/tenders/sources/extract";
import type { ExtractSource } from "../lib/tenders/sources/extract/types";
import { parseDayMonthYear } from "../lib/tenders/sources/extract/date";
import { findRedundant, titleSimilarity, SAME_TENDER_AT } from "../lib/tenders/redundancy";
import { followableNoticeUrl, sameParty, senderOrigin } from "../lib/tenders/display";
import { isActionable } from "../lib/tenders/actionable";
import { generateHandoffCode, normaliseHandoffCode, handoffFlowUrl, HANDOFF_ALPHABET } from "../lib/tenders/handoff-code";
import { parseLocality, projectPhrases } from "../lib/tenders/salesforce-match";
import { siteAddressFrom } from "../lib/tenders/site-address";
import { renderHandoff, idempotencyKey, type HandoffItem } from "../lib/tenders/notify";
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
ok("23 TenderSearch bulletins yield 187 notices", tsNotices.length === 187, `${tsNotices.length}`);
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

// ⚠️ THE INVARIANT, and the bug it was written for: a notice's link must come from that
// notice's OWN block. The extractor originally found one link for the whole bulletin and
// stamped it on every item, on a comment claiming they were all the same token — read off a
// two-notice bulletin where they happened to be. The 28-Sep bulletin has 10 notices and 10
// distinct tokens, so nine of its ten items linked to somebody else's tender, which is how
// it was reported ("the Wellington Shire item takes me somewhere that isn't it").
//
// Distinctness is NOT the test: TenderSearch legitimately gives several tenders from one
// publisher a single portal link, so asserting "N notices, N links" fails on good data.
// Containment is the thing that was actually broken.
ok("every notice's link appears in its OWN block", tsNotices.every((n) => !n.url || n.excerpt.includes(n.url)));
ok("every notice HAS a link", tsNotices.every((n) => !!n.url), `${tsNotices.filter((n) => !n.url).length} without`);
ok("...parsed day-first", tsNotices.every((n) => /^\d{4}-\d{2}-\d{2}$/.test(n.closesAt!)));
ok("most notices have a location", tsNotices.filter((n) => n.siteLocation).length >= tsNotices.length * 0.6,
   `${tsNotices.filter((n) => n.siteLocation).length}/${tsNotices.length}`);
ok("TenderSearch's own 'NOT STATED' placeholder is not stored as an address",
   tsNotices.every((n) => !/not stated|as stated/i.test(n.siteLocation ?? "")));
// Not "every": 1 of 187 archived notices carries no Contact line at all (a bare EOI with
// only a closing date). That was true of the first 47-notice sample and is not true in
// general — a proportion is the honest assertion, and it still catches the label breaking.
ok("nearly every notice names a contact", tsNotices.filter((n) => n.contact).length >= tsNotices.length * 0.95,
   `${tsNotices.filter((n) => n.contact).length}/${tsNotices.length}`);
ok("...with the 'GovDept' prefix stripped",
   tsNotices.every((n) => !/^GovDept/i.test(n.contact ?? "")));
ok("...and not running on into the contract number",
   tsNotices.every((n) => !/Contract No/i.test(n.contact ?? "")));
// The Wellington Shire card printed `/Technical GovDept Wellington Shire Council Ph: 1800 377
// 628` as BOTH its agency and its contact. The type marker was not first, so the ^-anchored
// strip missed it, and the switchboard number was never stripped at all.
ok("...with no department fragment left in front of the marker",
   tsNotices.every((n) => !/^[\s/]/.test(n.contact ?? "x") && !/\bGovDept\b/i.test(n.contact ?? "")),
   tsNotices.filter((n) => /^[\s/]|GovDept/i.test(n.contact ?? "")).map((n) => n.contact).join(" | ") || "clean");
ok("...and no switchboard number glued to the end",
   tsNotices.every((n) => !/\bPh:?\s*[\d ()+-]{6,}$/i.test(n.contact ?? "")),
   tsNotices.filter((n) => /\bPh:?\s*[\d ()+-]{6,}$/i.test(n.contact ?? "")).map((n) => n.contact).join(" | ") || "clean");
// agency and contact are the same value on purpose (TenderSearch has no agency line). The
// CARD is what must not repeat it — see sameParty() in view.tsx.
ok("agency and contact stay in step for this source",
   tsNotices.every((n) => n.agency === n.contact));

const fxMsgs = FIXTURES.filter((m) => (m.from ?? "").includes("felix"));
const fxNotices = fxMsgs.flatMap((m) => run(m) ?? []);
ok("9 Felix messages yield notices, minus the guest-access ones",
   fxNotices.length >= 5 && fxNotices.length < 9, `${fxNotices.length} of 9`);
// 5 notices, 3 references: the new-RFQ email and BOTH reminders for #126379 resolve to
// `felix:126379`, so the unique index on (source_slug, external_ref) collapses all three
// into one row. Previously each reminder carried a fresh tracking URL, keyed differently,
// and arrived as another opportunity — which is what group.ts had to approximate around.
ok("the messages about request #126379 collapse to one reference",
   fxNotices.filter((n) => n.externalRef === "felix:126379").length >= 3,
   `${new Set(fxNotices.map((n) => n.externalRef)).size} distinct of ${fxNotices.length}`);

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


// ── Buying for Victoria ──────────────────────────────────────────────────────────────────
//
// The generic parser took the reference CODE as the title, so the queue showed rows called
// "T2026-0816" with no project name, no agency and no closing date — every one no_match.
const vicMsg = FIXTURES.find((m) => (m.from ?? "").includes("tenders.vic.gov.au"))!;
const vicNotices = run(vicMsg) ?? [];
ok("the VIC alert yields its tender rows", vicNotices.length >= 4, `${vicNotices.length}`);
ok("...with a project name, never the reference code",
   vicNotices.every((n) => n.title.length > 12 && !/^[A-Z]{2,4}\d{4}-\d+$/.test(n.title)),
   vicNotices.map((n) => n.title.slice(0, 30)).join(" | "));
ok("...a buying agency", vicNotices.every((n) => n.agency && n.agency.length > 3));
ok("...never a UNSPSC classification line as the agency",
   vicNotices.every((n) => !/^\d{6,8}\s*-\s/.test(n.agency ?? "")));
ok("...a closing date", vicNotices.every((n) => n.closesAt !== null),
   vicNotices.map((n) => String(n.closesAt)).join(" "));
ok("...its OWN link, not one shared across the bulletin",
   new Set(vicNotices.map((n) => n.url)).size === vicNotices.length);
ok("...keyed on Victoria's own record id",
   vicNotices.every((n) => /^vic:\d+$/.test(n.externalRef)),
   vicNotices.map((n) => n.externalRef).join(" "));
// The subscriber token identifies the tenders@ account and must never reach the repo.
ok("the stored fixture carries no account token",
   !/ctid=(?!REDACTED)/.test(vicMsg.html));

// ── The daily redundancy sweep ───────────────────────────────────────────────────────────
//
// Cross-source only, and bucketed by closing date. Measured zero on real data the day it was
// written (43 cross-source pairs share a deadline, none are the same job), so these cases are
// synthetic on purpose — the point is that the rule discriminates, not that today's intake
// happens to be clean.
const sweep = findRedundant([
  { id: "a", title: "Pre and post construction dilapidation survey — Hume Highway", source_slug: "email:tendersearch.com.au", closes_at: "2026-10-07T04:00:00Z" },
  { id: "b", title: "Dilapidation survey, pre and post construction, Hume Highway", source_slug: "vendorpanel", closes_at: "2026-10-07T23:59:00Z" },
  { id: "c", title: "Supply and install playground equipment", source_slug: "vendorpanel", closes_at: "2026-10-07T09:00:00Z" },
  { id: "d", title: "Pre and post construction dilapidation survey — Hume Highway", source_slug: "email:tendersearch.com.au", closes_at: "2026-10-07T04:00:00Z" },
  { id: "e", title: "Dilapidation survey, pre and post construction, Hume Highway", source_slug: "vendorpanel", closes_at: "2026-11-30T00:00:00Z" },
  { id: "f", title: "Bridge deck rehabilitation", source_slug: "austender", closes_at: null },
]);
ok("the same tender from two portals is flagged", sweep.some((p) => p.left.id === "a" && p.right.id === "b") || sweep.some((p) => p.left.id === "b" && p.right.id === "a"));
ok("...and an unrelated tender closing the same day is not",
   !sweep.some((p) => [p.left.id, p.right.id].includes("c")),
   sweep.map((p) => `${p.left.id}~${p.right.id}`).join(" "));
ok("two copies WITHIN one source are left to group.ts",
   !sweep.some((p) => p.left.source === p.right.source));
ok("a different closing date is a different tender",
   !sweep.some((p) => [p.left.id, p.right.id].includes("e")));
ok("an item with no closing date is never paired",
   !sweep.some((p) => [p.left.id, p.right.id].includes("f")));
ok("the threshold is not so low that any two tenders match",
   titleSimilarity("Supply and install playground equipment", "Bridge deck rehabilitation works") < SAME_TENDER_AT);
ok("an identical title scores 1", titleSimilarity("Roadworks package B", "Roadworks package B") === 1);
ok("an empty title never matches", titleSimilarity("", "anything at all here") === 0);


// ── What a recipient can actually open ───────────────────────────────────────────────────
for (const [url, ok_] of [
  ["https://www.vendorpanel.com.au/tender/123", true],
  ["https://link.tendersearch.com.au/token/ABC", true],
  ["https://www.tenders.vic.gov.au/tender/view?id=1", true],
  // Graph's webLink: valid https, real host, and a sign-in page for an inbox the reader has
  // no access to. safeExternalUrl passes it, which is exactly why this test exists.
  ["https://outlook.office365.com/owa/?ItemID=AAMk", false],
  ["https://outlook.office.com/mail/inbox/id/AAMk", false],
  ["https://email.felix.net/f/a/Z0BNVeRbFWpyNUlIYwL0", false],
  ["not a url", false],
] as [string, boolean][]) {
  ok(`followable: ${url.slice(0, 46).padEnd(46)} -> ${ok_}`, (followableNoticeUrl(url) !== null) === ok_);
}

ok("sameParty sees past case and punctuation",
   sameParty("Wellington Shire Council", "wellington shire  council.") && !sameParty("MidCoast Council", "Murray River Council"));

const NOW = Date.parse("2026-10-01T00:00:00Z");
for (const [closes, want, why] of [
  [null, true, "no deadline = a live invitation"],
  ["2026-10-20T00:00:00Z", true, "weeks away"],
  ["2026-10-02T06:00:00Z", true, "just over 24h"],
  ["2026-10-01T06:00:00Z", false, "inside 24h"],
  ["2026-09-20T00:00:00Z", false, "closed"],
  ["not a date", true, "unparseable is not evidence it closed"],
] as [string | null, boolean, string][]) {
  ok(`actionable: ${String(closes).slice(0, 22).padEnd(22)} -> ${String(want).padEnd(5)} (${why})`,
     isActionable(closes, NOW) === want);
}

// ── The handoff email ────────────────────────────────────────────────────────────────────
const handoffItem = (over: Partial<HandoffItem> = {}): HandoffItem => ({
  ids: ["1"], title: "Condition Audit and Valuation of Buildings & Structures",
  agency: "Wellington Shire Council", siteLocation: "Wellington Shire, VIC",
  contact: "Wellington Shire Council", closesAt: "2026-10-20T00:00:00Z",
  relevance: "maybe", confidence: 0.78, services: ["dilapidation"],
  summary: "Council wants a consultant to inspect and condition-assess buildings.",
  seenCount: 1, sources: [{ label: "email:tendersearch.com.au", url: "https://link.tendersearch.com.au/token/A" }],
  senderTrusted: false, injectionSuspected: false, ...over,
});

const mailboxEmail = renderHandoff({
  items: [handoffItem({ sources: [{ label: "email:seymourwhyte.com.au", url: "https://outlook.office365.com/owa/?ItemID=AAMk" }], contact: "maira.barbosa@seymourwhyte.com.au", closesAt: null })],
}).html;
ok("a mailbox deep link NEVER reaches a recipient",
   !/outlook\.office|email\.felix\.net/i.test(mailboxEmail));
ok("...and the block says so instead of dropping the row",
   /Invitation by email/.test(mailboxEmail) && /maira\.barbosa@seymourwhyte\.com\.au/.test(mailboxEmail));
ok("an undated tender still gets a Closes row",
   /Not stated/.test(mailboxEmail));

// ── Where an invitation came from ────────────────────────────────────────────────────────
//
// A robot address is suppressed as a CONTACT but must still be SHOWN as provenance. Rhys,
// 2026-10-01, on Seymour Whyte RFQ #126379: the card said "invitation by email" and nothing
// else, because Felix sends from no-reply@felix.net.
for (const [from, kind] of [
  ["maira.barbosa@seymourwhyte.com.au", "reply"],
  ["farah.rahman@fultonhogan.com.au", "reply"],
  ["no-reply@felix.net", "via"],
  ["email@tendersearch.com.au", "via"],
  ["kylie.c@ausdilaps.com.au", "via"],
] as [string, string][]) {
  const o = senderOrigin(from);
  ok(`origin: ${from.padEnd(36)} -> ${kind}`, o?.kind === kind, String(o?.kind));
}
ok("no sender at all stays null", senderOrigin(null) === null && senderOrigin("  ") === null);

const robotEmail = renderHandoff({
  items: [handoffItem({ contact: null, emailFrom: "no-reply@felix.net", sources: [{ label: "email:felix.net", url: null }] })],
}).html;
ok("a robot sender is shown as provenance, not as a contact",
   /via no-reply@felix\.net/.test(robotEmail) && !/reply to no-reply/.test(robotEmail));
ok("...and a person is still offered as a reply-to",
   /reply to maira\.barbosa@seymourwhyte\.com\.au/.test(
     renderHandoff({ items: [handoffItem({ contact: null, emailFrom: "maira.barbosa@seymourwhyte.com.au", sources: [{ label: "email:seymourwhyte.com.au", url: null }] })] }).html
   ));

const plain = renderHandoff({ items: [handoffItem()] }).html;
// Triage artefacts: "flagged for review" describes a step completed by the act of sending,
// and sender_trusted is false for nearly everything since the trusted list was retired — so
// it printed warning-orange on genuine Tier-1 invitations.
ok("no triage badges on the email",
   !/Was flagged for review/i.test(plain) && !/Unverified sender/i.test(plain));
ok("the same party is never printed twice",
   (plain.match(/Wellington Shire Council/g) ?? []).length === 1,
   `${(plain.match(/Wellington Shire Council/g) ?? []).length} occurrences`);
ok("a real contact IS shown when it differs from the client",
   /Justin Van Niekerk/.test(renderHandoff({ items: [handoffItem({ contact: "Justin Van Niekerk" })] }).html));
ok("the location is labelled Location, not Address",
   /LOCATION|Location/.test(plain) && !/>Address</.test(plain));
// The live safety warning survives — it is about the text below, not about our process.
// ── Cross-source merging ─────────────────────────────────────────────────────────────────
//
// The SAME tender from two portals, which the exact key cannot see because they title it
// differently. Real case: Bega Valley Shire Council's asset revaluation arrived as two cards,
// two codes and two Salesforce records for one job.
const BEGA = [
  { id: "ts", title: "Water and Sewer Asset Revaluation, Data Validation and Condition Assessment",
    agency: "Bega Valley Shire Council", closesAt: "2026-10-23T00:00:00+00:00", confidence: 0.8, source: "email:tendersearch.com.au" },
  { id: "vp", title: "RFQ 2627-002 - Water and Sewer Asset Revaluation, Data Validation and Condition Assessment",
    agency: "Bega Valley Shire Council", closesAt: "2026-10-23T00:00:00+00:00", confidence: 0.75, source: "vendorpanel-public" },
];
const begaGroups = groupItems(BEGA);
ok("the same tender from two portals becomes ONE opportunity", begaGroups.length === 1, `${begaGroups.length} groups`);
ok("...keeping BOTH rows — nothing is dropped", begaGroups[0]?.count === 2);
ok("...and recording both keys, so an existing code is still found",
   (begaGroups[0]?.mergedKeys.length ?? 0) === 2, JSON.stringify(begaGroups[0]?.mergedKeys));
// The key is what a handoff code is stored against, so it must not depend on arrival order.
ok("the key does not depend on which portal emailed first",
   groupItems(BEGA).map((g) => g.key).join() === groupItems([...BEGA].reverse()).map((g) => g.key).join());

// ⚠️ The agency is what makes merging safe. Everything below must stay SEPARATE.
type BegaRow = { id: string; title: string; agency: string | null; closesAt: string | null; confidence: number; source: string };
const vary = (over: Partial<BegaRow>) => groupItems([BEGA[0], { ...BEGA[1], ...over }] as BegaRow[]).length;
ok("a DIFFERENT council closing the same day stays separate",
   vary({ agency: "Snowy Valleys Council" }) === 2);
ok("the same council on a DIFFERENT day stays separate",
   vary({ closesAt: "2026-11-30T00:00:00+00:00" }) === 2);
ok("an unrelated job from the same council on the same day stays separate",
   vary({ title: "Supply and install playground equipment" }) === 2);
// Blank values matching each other would collapse every untitled undated row into one card.
ok("a missing agency never merges", vary({ agency: null }) === 2);
ok("a missing closing date never merges", vary({ closesAt: null }) === 2);
ok("merging is stricter than the report threshold", MERGE_AT > SAME_TENDER_AT);

// Within-source grouping must be untouched by any of this.
ok("five copies from ONE source still collapse to one",
   groupItems(Array.from({ length: 5 }, (_, i) => ({
     id: `f${i}`, title: "126379 - Dilapidation Survey - Properties",
     agency: "Seymour Whyte", closesAt: null, confidence: 0.9,
   }))).length === 1);

// ── Site address ─────────────────────────────────────────────────────────────────────────
//
// Rhys, after testing TW-HTUUT: street came through as "City of Stonnington, VIC" and city as
// "CITY OF STONNINGTON". A tender almost never states a street — at tender stage the work
// spans a council area — so street must stay blank and the council noise comes off the city.
for (const [raw, want] of [
  ["City of Stonnington, VIC", { street: null, city: "Stonnington", state: "VIC", postcode: null, isLga: true }],
  ["Murray River Council LGA, NSW", { street: null, city: "Murray River", state: "NSW", postcode: null, isLga: true }],
  ["MidCoast Council road network, NSW", { street: null, city: "MidCoast", state: "NSW", postcode: null, isLga: true }],
  ["Wellington Shire, VIC", { street: null, city: "Wellington", state: "VIC", postcode: null, isLga: true }],
  // A genuine suburb keeps its name and is NOT an LGA.
  ["NORTH RICHMOND, NSW", { street: null, city: "North Richmond", state: "NSW", postcode: null, isLga: false }],
  ["GOONDIWINDI QLD", { street: null, city: "Goondiwindi", state: "QLD", postcode: null, isLga: false }],
  // A postcode the source STATED is a fact and is kept; one is never invented.
  ["LIVERPOOL, NSW, 2170, Australia", { street: null, city: "Liverpool", state: "NSW", postcode: "2170", isLga: false }],
  // A real street address is the one case where Street should be filled.
  ["26 Rankin Rd, Hastings VIC", { street: "26 Rankin Rd", city: "Hastings", state: "VIC", postcode: null, isLga: false }],
  ["Victoria (statewide arterial road network)", { street: null, city: null, state: null, postcode: null, isLga: false }],
  [null, { street: null, city: null, state: null, postcode: null, isLga: false }],
] as [string | null, Record<string, unknown>][]) {
  const got = siteAddressFrom(raw);
  const same = (Object.keys(want) as (keyof typeof got)[]).every((k) => got[k] === want[k]);
  ok(`site: ${String(raw).slice(0, 38).padEnd(38)} -> ${want.city ?? "null"}`, same, JSON.stringify(got));
}

// ── Handoff codes ────────────────────────────────────────────────────────────────────────
//
// Typed into Salesforce off a phone screen, and sometimes read aloud, so the confusable
// characters must not be in the alphabet at all.
for (const bad of ["O", "0", "I", "1", "L", "S", "5", "Z", "2", "B", "8"]) {
  ok(`alphabet excludes ${bad}`, !HANDOFF_ALPHABET.includes(bad));
}
ok("codes look like TW-XXXXX", /^TW-[A-Z0-9]{5}$/.test(generateHandoffCode()));
ok("codes are not predictable",
   new Set(Array.from({ length: 200 }, generateHandoffCode)).size > 190);

// Forgiving on input: somebody will drop the dash, lower-case it, or paste a trailing space.
for (const [raw, want] of [
  ["TW-4F7K9", "TW-4F7K9"],
  ["tw-4f7k9", "TW-4F7K9"],
  ["TW4F7K9", "TW-4F7K9"],
  ["  tw 4f7k9 ", "TW-4F7K9"],
  ["4F7K9", "TW-4F7K9"],
  // Strict where it matters — a character outside the alphabet is REJECTED, never corrected
  // into a different valid code that would pre-fill the wrong tender.
  ["TW-4F7K0", null],
  ["TW-4F7KO", null],
  ["TW-4F7K", null],
  ["TW-4F7K99", null],
  ["", null],
  [null, null],
] as [string | null, string | null][]) {
  ok(`code: ${JSON.stringify(raw).padEnd(14)} -> ${want ?? "null"}`, normaliseHandoffCode(raw) === want, String(normaliseHandoffCode(raw)));
}
// Round-trip: anything we mint must be accepted back.
ok("every generated code normalises to itself",
   Array.from({ length: 300 }, generateHandoffCode).every((c) => normaliseHandoffCode(c) === c));
// The email's "Create in Salesforce" button: the code rides in as the flow's input variable,
// and nothing that isn't a valid code can reach the URL.
{
  const u = new URL(handoffFlowUrl("tw 4f7k3")!);
  ok("flow link: opens the TenderWatch flow", u.pathname === "/flow/Screen_Flow_New_Opportunity_TenderWatch", u.pathname);
  ok("flow link: carries the canonical code", u.searchParams.get("varTenderCode") === "TW-4F7K3", String(u.searchParams.get("varTenderCode")));
  ok("flow link: returns somewhere on Finish", !!u.searchParams.get("retURL"));
  ok("flow link: none for a non-code", handoffFlowUrl('"><script>') === null && handoffFlowUrl(null) === null);
}

// ── Repeated category prefix ─────────────────────────────────────────────────────────────
//
// TenderSearch prefixes a notice with its CATEGORY, and when that is also how the buyer
// worded the title you get it twice before the actual subject — the first thing a reader
// sees on the card and in the email.
for (const [raw, want] of [
  ["Expression of Interest - Expression of Interest (EOI) Invitation for Statewide Pavement Data Survey Services.",
   "Expression of Interest (EOI) Invitation for Statewide Pavement Data Survey Services."],
  ["Tender - Tender for roadworks", "Tender for roadworks"],
  // Real titles that merely CONTAIN a dash must survive untouched.
  ["T27014 - Building Asset Condition Audit 26-27", "T27014 - Building Asset Condition Audit 26-27"],
  ["126379 - Dilapidation Survey - Properties", "126379 - Dilapidation Survey - Properties"],
  ["Muswellbrook Bypass Project - Dilapidation Survey", "Muswellbrook Bypass Project - Dilapidation Survey"],
  ["Condition Audit and Valuation of Buildings & Structures", "Condition Audit and Valuation of Buildings & Structures"],
] as [string, string][]) {
  ok(`prefix: ${raw.slice(0, 40).padEnd(40)}`, displayTitle({ title: raw }) === want, displayTitle({ title: raw }).slice(0, 60));
}

// ── The Salesforce duplicate check ───────────────────────────────────────────────────────
//
// Locality is the primary join. These are the live queue's real values.
for (const [loc, want] of [
  ["GOONDIWINDI QLD", "GOONDIWINDI|QLD"],
  ["NORTH RICHMOND, NSW", "NORTH RICHMOND|NSW"],
  ["Murray River Council LGA, NSW", "MURRAY RIVER COUNCIL LGA|NSW"],
  ["LIVERPOOL, NSW, 2170, Australia", "LIVERPOOL|NSW"],
  // No suburb to match by construction — this is what the project fallback is for.
  ["Victoria (statewide arterial road network)", null],
  [null, null],
] as [string | null, string | null][]) {
  const l = parseLocality(loc);
  ok(`locality: ${String(loc).slice(0, 38).padEnd(38)} -> ${want ?? "null"}`,
     (l ? `${l.suburb}|${l.state}` : null) === want, String(l && `${l.suburb}|${l.state}`));
}

// ⚠️ Felix RFQ #126379 names its project ONLY in the RFQ-owner field, and Salesforce holds
// PRE OPT-37387 "Fifteenth Avenue Upgrade, Austral NSW" in Follow Up. A live duplicate the
// suburb join could never see — this is the case the fallback exists for.
ok("the project name is found in a NON-LEAD member's agency",
   projectPhrases(["126379 - Dilapidation Survey - Properties", "Seymour Whyte", "Fifteenth Avenue Upgrade (RFQ owner Rebecca Saunders)"]).includes("Fifteenth Avenue"),
   projectPhrases(["126379 - Dilapidation Survey - Properties", "Seymour Whyte", "Fifteenth Avenue Upgrade (RFQ owner Rebecca Saunders)"]).join(" | "));
ok("...and in the title", projectPhrases(["Dilapidation Report RFQ — Australia Avenue Tender"]).includes("Australia Avenue"));
ok("...including infrastructure words a postal street list would miss",
   projectPhrases(["Muswellbrook Bypass Project - Dilapidation Survey"]).includes("Muswellbrook Bypass"));
// Without the stoplist these match hundreds of our own opportunities.
ok("OUR vocabulary never becomes a project name",
   projectPhrases(["Pre & post construction building condition assessment"]).length === 0 &&
   projectPhrases(["Condition Audit and Valuation of Buildings & Structures"]).length === 0,
   projectPhrases(["Pre & post construction building condition assessment"]).join(" | "));
ok("a bracketed aside is metadata, not the project",
   !projectPhrases(["Seymour Whyte (RFQ owner Rebecca Saunders)"]).some((p) => /Saunders/.test(p)));
ok("a street NUMBER is not part of the name",
   !projectPhrases(["375 Fifteenth Avenue"]).includes("375 Fifteenth"));
ok("at most two phrases are searched",
   projectPhrases(["Smith Street and Jones Road and Brown Avenue and Green Lane"]).length <= 2);

// ── Idempotency ──────────────────────────────────────────────────────────────────────────
//
// Resend rejects a reused key whose body changed (409), so a key that ignores the body blocks
// a legitimate re-send for 24 hours. Hit live twice on 2026-10-01 after the email was fixed.
const keyFor = (over: { items?: HandoffItem[]; to?: string[]; subject?: string; html?: string } = {}) =>
  idempotencyKey({ items: [handoffItem()], to: ["info@ausdilaps.com.au"], subject: "s", html: "<p>a</p>", ...over });

ok("an identical double-click collapses to one key", keyFor() === keyFor());
ok("a changed body gets its own key", keyFor() !== keyFor({ html: "<p>b</p>" }));
ok("a different recipient gets its own key", keyFor() !== keyFor({ to: ["rhys.m@ausdilaps.com.au"] }));
ok("recipient ORDER does not matter",
   keyFor({ to: ["a@x.com", "b@x.com"] }) === keyFor({ to: ["b@x.com", "a@x.com"] }));
ok("a different selection gets its own key",
   keyFor() !== keyFor({ items: [handoffItem({ ids: ["other"] })] }));

ok("an injection flag is still shown",
   /Flagged content/i.test(renderHandoff({ items: [handoffItem({ injectionSuspected: true })] }).html));

console.log(fails === 0 ? "\nAll passed." : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
