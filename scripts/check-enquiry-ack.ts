// npm run check:ack — pure. Renders every branch of the enquiry acknowledgement
// (lib/emails/enquiry-ack.ts) and writes HTML previews to the directory given as argv[2]
// (default: scratchpad/ack-previews) so they can be opened in a browser.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enquiryAckEmail } from "@/lib/emails/enquiry-ack";
import { INQUIRY_TYPES, quoteSchema, type QuoteInput } from "@/lib/leads";

const site = "https://ausdilaps.com.au";
const base = (over: Partial<QuoteInput>): QuoteInput =>
  quoteSchema.parse({ inquiryType: "General Inquiry", name: "Rhys Morgan", email: "rhys@example.com", ...over });

const out = process.argv[2] ?? "scratchpad/ack-previews";
mkdirSync(out, { recursive: true });

const cases: Record<(typeof INQUIRY_TYPES)[number], QuoteInput> = {
  "New Quote": base({
    inquiryType: "New Quote",
    name: "Priya Nair",
    company: "CPB Contractors",
    projectName: "Western Tunnelling Package",
    projectLocation: "Rozelle NSW",
    assetCount: "100+",
  }),
  "I Received An Access Letter": base({
    inquiryType: "I Received An Access Letter",
    name: "Tom O'Brien",
    propertyRole: "Tenant",
    contactAddress: "12 Craig Avenue, Vaucluse NSW 2030",
    contactMethod: ["SMS", "Call"],
  }),
  "Report Inquiry": base({
    inquiryType: "Report Inquiry",
    name: "Sam Lee",
    contactAddress: "44 Eastern Avenue, Dover Heights NSW 2030",
    projectNumber: "OPT-25824",
    documentId: "DOC-4471",
  }),
  "General Inquiry": base({ inquiryType: "General Inquiry", name: "Alex" }),
};

for (const type of INQUIRY_TYPES) {
  const email = enquiryAckEmail({ input: cases[type], siteUrl: `${site}/`, samplesCode: "AD-1234" });
  assert.ok(email.html.includes(`${site}/logo/ad-logo.png`), `${type}: logo is an absolute URL`);
  // Samples go ONLY to a quote request (Rhys, 2026-10-05).
  if (type === "New Quote") {
    assert.ok(email.html.includes("/dilapidation-reports/samples?code=AD-1234"), "quote: samples link carries the code");
  } else {
    assert.ok(!email.html.includes("/dilapidation-reports/samples"), `${type}: no samples link`);
  }
  if (type !== "I Received An Access Letter") {
    // A resident answering an access letter doesn't need our capability statement.
    assert.ok(email.html.includes("/AusDilaps-Capability-Statement-FY25-26.pdf"), `${type}: capability statement linked`);
  }
  assert.ok(email.html.includes("1800 345 277"), `${type}: phone`);
  assert.ok(email.text.includes("WHILE YOU WAIT"), `${type}: plain text has the links block`);
  assert.ok(!email.html.includes("undefined"), `${type}: nothing undefined`);
  const slug = type.toLowerCase().replace(/[^a-z]+/g, "-");
  writeFileSync(join(out, `${slug}.html`), email.html);
  writeFileSync(join(out, `${slug}.txt`), `${email.subject}\n\n${email.text}`);
}

// Branch content.
const quote = enquiryAckEmail({ input: cases["New Quote"], siteUrl: site });
assert.ok(quote.html.includes("Western Tunnelling Package, Rozelle NSW"), "quote names the project");
assert.ok(quote.html.includes("An estimator will be assigned to your scope shortly"), "quote: estimator line");
assert.ok(quote.html.includes("Once your estimator is assigned") && quote.html.includes("Kick-off, once approved"), "quote explains the steps");
assert.ok(quote.html.includes("/dilapidation-reports/samples\""), "no code → plain samples link");

const letter = enquiryAckEmail({ input: cases["I Received An Access Letter"], siteUrl: site });
assert.ok(letter.html.includes("12 Craig Avenue, Vaucluse NSW 2030"), "letter echoes the address");
assert.ok(letter.html.includes("We'll get in touch with you") && letter.html.includes("By SMS or phone"), "letter uses the chosen contact method");
assert.ok(letter.html.includes("15 to 45 minutes"), "letter sets expectations on the inspection");
const letterAll = enquiryAckEmail({ input: base({ inquiryType: "I Received An Access Letter", contactMethod: ["SMS", "Call", "Email"] }), siteUrl: site });
assert.ok(letterAll.html.includes("By SMS, phone or email, as you asked."), "three methods read as a list");
const letterNone = enquiryAckEmail({ input: base({ inquiryType: "I Received An Access Letter" }), siteUrl: site });
assert.ok(letterNone.html.includes("By SMS, phone or email."), "no method ticked → all three");
assert.ok(letter.html.includes("Hi Tom,"), "apostrophe in the surname doesn't break the greeting");

const report = enquiryAckEmail({ input: cases["Report Inquiry"], siteUrl: site });
// The address leads; references are never echoed back (staff feedback, 2026-10-08).
assert.ok(report.html.includes("44 Eastern Avenue"), "report echoes the property address");
assert.ok(!report.html.includes("OPT-25824") && !report.html.includes("DOC-4471"), "report never echoes references");
const reportNoAddress = enquiryAckEmail({ input: base({ inquiryType: "Report Inquiry", name: "Sam" }), siteUrl: site });
assert.ok(reportNoAddress.html.includes("Reply with the property address"), "report without an address asks for one");

// Hostile input: a name that is a URL gets the neutral greeting, and markup is escaped.
const hostile = enquiryAckEmail({
  input: base({ name: "https://evil.example/x", projectName: "<img src=x onerror=alert(1)>", inquiryType: "New Quote" }),
  siteUrl: site,
});
assert.ok(hostile.html.includes("Hi there,"), "URL-shaped name → neutral greeting");
assert.ok(!hostile.html.includes("<img src=x"), "project name is escaped");
assert.ok(hostile.html.includes("&lt;img src=x"), "…as an entity");

console.log(`✓ enquiry acknowledgement: 4 branches render, previews in ${out}/`);
