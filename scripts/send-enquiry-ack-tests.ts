// npm run send:ack -- you@ausdilaps.com.au
// Sends one enquiry acknowledgement per enquiry type to the address given, through Resend,
// using RESEND_API_KEY / RESEND_FROM_EMAIL / NEXT_PUBLIC_SITE_URL / SAMPLES_ACCESS_CODE
// from .env.local (loaded by the npm script's --env-file). Nothing is written anywhere.
import { enquiryAckEmail } from "@/lib/emails/enquiry-ack";
import { INQUIRY_TYPES, quoteSchema, type QuoteInput } from "@/lib/leads";
import { accessCodes } from "@/lib/samples-access";

const to = process.argv[2];
if (!to || !to.includes("@")) {
  console.error("usage: npm run send:ack -- you@ausdilaps.com.au");
  process.exit(1);
}
const key = process.env.RESEND_API_KEY;
if (!key) {
  console.error("RESEND_API_KEY is not set in .env.local");
  process.exit(1);
}
const from = process.env.RESEND_FROM_EMAIL ?? "AusDilaps <no-reply@ausdilaps.com.au>";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ausdilaps.com.au";

const base = (over: Partial<QuoteInput>): QuoteInput =>
  quoteSchema.parse({ inquiryType: "General Inquiry", name: "Rhys Morgan", email: to, ...over });
const cases: Record<(typeof INQUIRY_TYPES)[number], QuoteInput> = {
  "New Quote": base({ inquiryType: "New Quote", company: "CPB Contractors", projectName: "Western Tunnelling Package", projectLocation: "Rozelle NSW", assetCount: "100+" }),
  "I Received An Access Letter": base({ inquiryType: "I Received An Access Letter", propertyRole: "Tenant", contactAddress: "12 Craig Avenue, Vaucluse NSW 2030", contactMethod: ["SMS", "Call"] }),
  "Report Inquiry": base({ inquiryType: "Report Inquiry", projectNumber: "OPT-25824", documentId: "DOC-4471" }),
  "General Inquiry": base({ inquiryType: "General Inquiry" }),
};

async function main() {
  for (const type of INQUIRY_TYPES) {
    const e = enquiryAckEmail({ input: cases[type], siteUrl, samplesCode: accessCodes()[0] });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: `[TEST · ${type}] ${e.subject}`, html: e.html, text: e.text }),
    });
    console.log(`${res.ok ? "✓" : "✗"} ${type} ${res.status}${res.ok ? "" : ` ${await res.text()}`}`);
  }
}
main();
