/**
 * Mailbox parsing + sender routing checks.
 *
 *   npm run check:tenders
 *
 * No tenant, no network, no database — pure functions over synthetic Graph messages, so
 * this runs anywhere and is the right place to pin the digest parsers as portals change.
 *
 * It exists because of a bug it caught on its first run: buy.nsw's RFT-2026-001 and
 * RFT-2026-002 both reduced to the dedupe key `atm:RFT2026`, so the second tender was
 * silently discarded as a duplicate of the first. That failure is invisible in production
 * — no error, no empty result, just a tender nobody ever sees. Keep the "all keyed
 * distinctly" assertion.
 *
 * When a portal changes its format, add a real sample here first, watch it fail, then fix
 * the parser.
 */

import { parseMessages, type GraphMessage } from "../lib/tenders/sources/mailbox";
import { MAILBOX_SOURCES, routeSender, isTrustedSender, CATCH_ALL_SLUG } from "../lib/tenders/senders";

let fails = 0;
const ok = (l: string, c: boolean, extra = "") => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"}  ${l}${extra ? ` — ${extra}` : ""}`); };
const src = (slug: string) => MAILBOX_SOURCES.find((s) => s.slug === slug)!;

const msg = (o: Partial<GraphMessage> & { from: string }): GraphMessage => ({
  id: o.id ?? `id-${Math.round(o.receivedDateTime ? 1 : 2)}-${o.subject}`,
  internetMessageId: o.internetMessageId ?? `<${o.subject}@test>`,
  subject: o.subject ?? "(no subject)",
  from: { emailAddress: { address: o.from } },
  receivedDateTime: o.receivedDateTime ?? "2026-08-27T02:00:00Z",
  hasAttachments: o.hasAttachments ?? false,
  body: o.body,
  bodyPreview: o.bodyPreview,
  webLink: o.webLink ?? "https://outlook.office365.com/x",
});

// ── A realistic buy.nsw digest: 3 tenders + unsubscribe/footer noise ────────────
const buynswHtml = `
<html><body>
  <p>Your daily opportunities</p>
  <a href="https://buy.nsw.gov.au/opportunity/RFT-2026-001">Dilapidation Survey Services — Sydney Metro</a>
  <a href="https://buy.nsw.gov.au/opportunity/RFT-2026-002">Structural Condition Assessment — Parramatta Light Rail</a>
  <a href="https://buy.nsw.gov.au/tender/EOI-2026-099">EOI: Pre-condition surveys, M6 Stage 1</a>
  <a href="https://buy.nsw.gov.au/unsubscribe?u=123">Unsubscribe</a>
  <a href="https://twitter.com/buynsw">Follow us</a>
</body></html>`;

const digest = msg({ from: "noreply@buy.nsw.gov.au", subject: "buy.nsw daily digest",
  body: { contentType: "html", content: buynswHtml } });

const items = parseMessages([digest], src("buynsw-digest"));
console.log(`\n--- buy.nsw digest -> ${items.length} items ---`);
for (const i of items) console.log(`    ${i.externalRef.slice(0, 26)}  ${i.title.slice(0, 52)}`);
ok("digest yields one item per tender link", items.length === 3, `${items.length}`);
ok("unsubscribe/social links excluded", !items.some((i) => /unsubscribe|twitter/.test(i.url ?? "")));
ok("anchor text becomes the title", items[0].title.includes("Dilapidation Survey Services"), items[0].title);
ok("all keyed distinctly", new Set(items.map((i) => i.externalRef)).size === 3);
ok("sender trusted", items.every((i) => i.senderTrusted === true));
ok("routed to buynsw-digest", items.every((i) => i.sourceSlug === "buynsw-digest"));

// ── Reordering the digest must not change the keys ──────────────────────────────
const reordered = buynswHtml.replace(
  /(<a href="https:\/\/buy\.nsw\.gov\.au\/opportunity\/RFT-2026-001">[^<]*<\/a>)\s*(<a href="https:\/\/buy\.nsw\.gov\.au\/opportunity\/RFT-2026-002">[^<]*<\/a>)/,
  "$2\n  $1"
);
const items2 = parseMessages([msg({ from: "alerts@buy.nsw.gov.au", subject: "buy.nsw daily digest",
  body: { contentType: "html", content: reordered } })], src("buynsw-digest"));
ok("keys are stable when the digest reorders",
   JSON.stringify([...items.map((i) => i.externalRef)].sort()) === JSON.stringify([...items2.map((i) => i.externalRef)].sort()),
   "reorder changed the dedupe keys");
ok("a different sender on the same domain still routes there", items2.every((i) => i.sourceSlug === "buynsw-digest"));

// ── Digest with no matching links falls back rather than vanishing ──────────────
const noLinks = parseMessages([msg({ from: "noreply@buy.nsw.gov.au", subject: "Format changed",
  body: { contentType: "html", content: "<p>We have moved. Log in to view.</p>" } })], src("buynsw-digest"));
ok("digest with no tender links still yields one item", noLinks.length === 1, `${noLinks.length}`);
ok("...and says so in the excerpt", noLinks[0].excerpt.includes("no tender links matched"));

// ── Direct invite: attachment, almost no body ──────────────────────────────────
const invite = parseMessages([msg({ from: "sarah.tan@bigconstructionco.com.au",
  subject: "Dilapidation pricing — Northern Rd Stage 4", hasAttachments: true,
  body: { contentType: "text", content: "Hi team, please see attached. Thanks" } })], src(CATCH_ALL_SLUG));
ok("unknown sender routes to the catch-all", invite.length === 1 && invite[0].sourceSlug === CATCH_ALL_SLUG);
ok("attachment-with-no-body is flagged for the classifier",
   invite[0].excerpt.includes("probably in the attachment"), invite[0].excerpt.slice(0, 80));
ok("unknown sender is NOT trusted", invite[0].senderTrusted === false);
ok("agency falls back to the sender domain", invite[0].agency === "bigconstructionco.com.au", String(invite[0].agency));

// ── Routing table ──────────────────────────────────────────────────────────────
const routes: [string, string][] = [
  ["noreply@buy.nsw.gov.au", "buynsw-digest"],
  ["x@mail.buy.nsw.gov.au", "buynsw-digest"],
  ["alerts@qtenders.hpw.qld.gov.au", "qtenders-alert"],
  ["no-reply@tendersearch.com.au", "tendersearch"],
  ["pm@somecouncil.nsw.gov.au", CATCH_ALL_SLUG],
  ["spam@evil.example", CATCH_ALL_SLUG],
];
for (const [from, expect] of routes) {
  const got = routeSender(from).slug;
  ok(`route ${from.padEnd(34)} -> ${expect}`, got === expect, got);
}
ok("a lookalike domain is not trusted", isTrustedSender("x@buy.nsw.gov.au.evil.com") === false);
ok("no source claims a sender it shouldn't",
   parseMessages([msg({ from: "noreply@buy.nsw.gov.au", subject: "x", body: { contentType: "text", content: "y" } })],
     src("qtenders-alert")).length === 0);

console.log(fails === 0 ? "\nAll passed." : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
