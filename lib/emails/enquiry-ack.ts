/**
 * The acknowledgement email a visitor gets after the enquiry form.
 *
 * Pure: no Next, no env, no network — `app/api/quote/route.ts` hands it the input and the
 * site URL, `npm run check:ack` renders every branch headlessly and `npm run send:ack`
 * emails them to an address. The content is per ENQUIRY TYPE (Rhys, 2026-10-05: a resident
 * who got an access letter and a contracts administrator wanting a quote are asking
 * completely different questions, and one dry "thanks for your enquiry" served neither),
 * with a "while you wait" block pointing at something worth their time.
 *
 * ⚠️ SAMPLE REPORTS GO ONLY TO A QUOTE REQUEST (Rhys, 2026-10-05). The samples library is
 * for people buying a report; a resident answering an access letter, or someone asking
 * about a report they already hold, gets the FAQ and the explainer instead. The samples
 * link carries the access code so the recipient lands in the library without re-typing
 * the name and email the form already took.
 *
 * Facts come from lib/site.ts and data/faq.ts (the methodology steps, the 15-to-45-minute
 * inspection). Don't add a claim you can't point at.
 *
 * ⚠️ The recipient is whoever typed the address, so everything reflected back (name,
 * project, address, references) goes through `escapeHtml`, and the greeting falls back to
 * "Hi there" when the first name looks like a URL or an email — this is a DKIM-signed
 * message from us to a stranger, so a linkified name is a free phishing lure.
 *
 * Email HTML, not web HTML: tables, inline styles, absolute image URLs. ONE card (Rhys:
 * the grey "while you wait" band read as a second, broken-off card), the site's tokens
 * from app/globals.css repeated inline, Space Grotesk / Inter requested from Google Fonts
 * with system fallbacks for the clients that refuse web fonts (Gmail, Outlook desktop).
 * The logo is `${siteUrl}/logo/ad-logo.png`, the same committed file the site header uses.
 */
import { escapeHtml } from "@/lib/html";
import type { ContactMethod, QuoteInput } from "@/lib/leads";
import { CAPABILITY_HREF, SITE } from "@/lib/site";
import { SAMPLES_PATH } from "@/lib/samples-access";

export type AckEmail = { subject: string; html: string; text: string };

export type AckInput = {
  input: QuoteInput;
  /** Absolute origin, no trailing slash — `https://ausdilaps.com.au`. */
  siteUrl: string;
  /** A still-configured samples access code. Only ever used on the New Quote branch. */
  samplesCode?: string;
};

type Link = { title: string; body: string; href: string; cta: string };

type Content = {
  headline: string;
  subject: string;
  /** Paragraphs, already escaped. */
  intro: string[];
  /** Heading over the steps, e.g. "What happens next". */
  stepsHeading: string;
  /** Already escaped. */
  steps: { title: string; body: string }[];
  /** The orange button. */
  primary: Link;
  /** The rest of "while you wait". */
  links: Link[];
};

// app/globals.css tokens — an email can't load a stylesheet, so they're repeated here.
const INK = "#2f343a"; // --color-ad-ink
const MUTED = "#5b6570"; // --color-ad-muted
const STEEL = "#46688a"; // --color-ad-steel
const STEEL_LIGHT = "#6d90b4"; // --color-ad-steel-light
const ORANGE = "#e8642a"; // --color-ad-orange
const SURFACE = "#f3f4f5"; // --color-ad-surface
const BORDER = "#e1e3e6"; // --color-ad-border (rgba 12% ink) flattened on white
const RADIUS = "10px"; // --radius-md
const FONT_BODY = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FONT_HEADING = "'Space Grotesk',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const trimSlash = (u: string) => u.replace(/\/+$/, "");

/** How a chosen contact method reads mid-sentence ("by SMS or phone"). */
const CONTACT_WORD: Record<ContactMethod, string> = { SMS: "SMS", Call: "phone", Email: "email" };

function greetingFor(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  if (!first || /[/:@\\<>]/.test(first) || first.length > 30) return "Hi there";
  return `Hi ${escapeHtml(first)}`;
}

function contentFor(d: QuoteInput, siteUrl: string, samplesCode?: string): Content {
  const samples: Link = {
    title: "See a finished report",
    body: "Sample reports across residential, commercial and infrastructure jobs.",
    href: samplesCode
      ? `${siteUrl}${SAMPLES_PATH}?code=${encodeURIComponent(samplesCode)}`
      : `${siteUrl}${SAMPLES_PATH}`,
    cta: "View sample reports",
  };
  const capability: Link = {
    title: "Capability statement",
    body: "Our methodology, team and Tier 1 project history.",
    href: `${siteUrl}${CAPABILITY_HREF}`,
    cta: "Download the PDF",
  };
  const faq: Link = {
    title: "Common questions",
    body: "What's inspected, who arranges it, what happens if something is found.",
    href: `${siteUrl}/faq`,
    cta: "Read the FAQ",
  };
  const whatIs: Link = {
    title: "What a dilapidation report is",
    body: "A two-minute explainer on what gets inspected and why.",
    href: `${siteUrl}/insights/what-is-a-dilapidation-report`,
    cta: "Read the explainer",
  };

  const project = [d.projectName, d.projectLocation].filter(Boolean).map(escapeHtml);

  switch (d.inquiryType) {
    case "New Quote":
      return {
        subject: "We've received your quote request — AusDilaps",
        headline: "Your quote request is in.",
        intro: [
          project.length > 0
            ? `Thanks for the details on <strong>${project.join(", ")}</strong>. An estimator will be assigned to your scope shortly.`
            : "Thanks for the details. An estimator will be assigned to your scope shortly.",
        ],
        stepsHeading: "Once your estimator is assigned",
        steps: [
          { title: "Scope review", body: "Site, adjoining properties, DA conditions and any contract clauses." },
          { title: "Itemised quote", body: "Clear pricing, methodology and deliverables." },
          { title: "Kick-off, once approved", body: "A project coordinator confirms access and scheduling." },
        ],
        primary: samples,
        links: [capability, faq],
      };

    case "I Received An Access Letter":
      return {
        subject: "About your access letter — AusDilaps",
        headline: "About your access letter.",
        intro: [
          d.contactAddress
            ? `Thanks for getting in touch about <strong>${escapeHtml(d.contactAddress)}</strong>.`
            : "Thanks for getting in touch.",
          "In short: a construction project near you has engaged us to record the condition of nearby properties before work starts. The report is an independent photographic record of your property, so there's a clear baseline if anything changes during the works.",
        ],
        stepsHeading: "What happens next",
        steps: [
          {
            title: "We'll get in touch with you",
            body: d.contactMethod?.length
              ? `By ${d.contactMethod.map((m) => CONTACT_WORD[m]).join(" or ")}, as you asked.`
              : "Our projects team will contact you shortly.",
          },
          { title: "If you'd like to arrange a time", body: "We'll book one that suits you." },
          { title: "The inspection", body: "A standard home takes 15 to 45 minutes." },
        ],
        primary: whatIs,
        links: [faq],
      };

    case "Report Inquiry": {
      const refs = [
        d.projectNumber ? `project number <strong>${escapeHtml(d.projectNumber)}</strong>` : "",
        d.documentId ? `document ID <strong>${escapeHtml(d.documentId)}</strong>` : "",
      ].filter(Boolean);
      return {
        subject: "We've received your report enquiry — AusDilaps",
        headline: "We've received your report enquiry.",
        intro: [
          refs.length > 0
            ? `Thanks. With ${refs.join(" and ")} we can find your report straight away, and we'll come back to you shortly.`
            : "Thanks, we'll come back to you shortly. If you have a project or OPT number, or the document ID from the report, reply with it and we'll find it faster.",
        ],
        stepsHeading: "",
        steps: [],
        primary: faq,
        links: [capability],
      };
    }

    case "General Inquiry":
    default:
      return {
        subject: "We've received your enquiry — AusDilaps",
        headline: "Thanks for getting in touch.",
        intro: ["We've got your enquiry and the right person will come back to you shortly."],
        stepsHeading: "",
        steps: [],
        primary: capability,
        links: [faq],
      };
  }
}

export function enquiryAckEmail({ input, siteUrl, samplesCode }: AckInput): AckEmail {
  const base = trimSlash(siteUrl);
  const c = contentFor(input, base, samplesCode);
  const greeting = greetingFor(input.name);
  const logo = `${base}/logo/ad-logo.png`;
  const tel = `tel:${SITE.phone.replace(/\s+/g, "")}`;

  const para = (s: string) =>
    `<p style="margin:0 0 16px;font-family:${FONT_BODY};font-size:16px;line-height:1.65;color:${INK};">${s}</p>`;
  const eyebrow = (s: string) =>
    `<p style="margin:0 0 14px;font-family:${FONT_BODY};font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${STEEL};">${s}</p>`;

  const stepsHtml =
    c.steps.length === 0
      ? ""
      : `<div style="height:28px;line-height:28px;font-size:0;">&nbsp;</div>
${eyebrow(c.stepsHeading)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${c.steps
  .map(
    (s, i) => `<tr>
  <td valign="top" style="width:38px;padding:0 0 12px;"><div style="width:26px;height:26px;border-radius:13px;background:${STEEL};color:#ffffff;font-family:${FONT_HEADING};font-size:13px;font-weight:700;line-height:26px;text-align:center;">${i + 1}</div></td>
  <td valign="top" style="padding:3px 0 12px;font-family:${FONT_BODY};font-size:15px;line-height:1.5;color:${INK};"><strong>${s.title}</strong> <span style="color:${MUTED};">— ${s.body}</span></td>
</tr>`
  )
  .join("\n")}
</table>`;

  const linkRow = (l: Link) => `<tr>
  <td style="padding:14px 0;border-top:1px solid ${BORDER};font-family:${FONT_BODY};font-size:15px;font-weight:600;color:${INK};">${l.title}<span style="display:block;font-size:13px;font-weight:400;line-height:1.5;color:${MUTED};margin-top:2px;">${l.body}</span></td>
  <td align="right" valign="middle" style="padding:14px 0 14px 16px;border-top:1px solid ${BORDER};white-space:nowrap;"><a href="${escapeHtml(l.href)}" style="font-family:${FONT_BODY};font-size:14px;font-weight:600;color:${STEEL};text-decoration:none;">${l.cta} &rarr;</a></td>
</tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(c.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${SURFACE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(c.headline)} Here's what happens next.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SURFACE};">
<tr><td align="center" style="padding:32px 16px;">

<!-- The card -->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${BORDER};border-radius:${RADIUS};">

  <!-- Logo -->
  <tr><td style="padding:30px 40px 24px;">
    <a href="${base}" style="text-decoration:none;"><img src="${logo}" width="160" height="59" alt="AusDilaps — Specialist Building Inspections" style="display:block;width:160px;height:auto;border:0;"></a>
  </td></tr>
  <!-- Steel accent rule, the site's .rule-accent -->
  <tr><td style="padding:0 40px;"><div style="height:2px;border-radius:2px;background:${STEEL};background-image:linear-gradient(90deg,${STEEL},${STEEL_LIGHT});font-size:0;line-height:0;">&nbsp;</div></td></tr>

  <!-- Body -->
  <tr><td style="padding:30px 40px 12px;">
    <h1 style="margin:0 0 18px;font-family:${FONT_HEADING};font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.01em;color:${INK};">${escapeHtml(c.headline)}</h1>
    ${para(`${greeting},`)}
    ${c.intro.map(para).join("\n    ")}
    ${stepsHtml}
    <div style="height:14px;font-size:0;">&nbsp;</div>
    ${para(`If it's urgent, call us on <a href="${tel}" style="color:${INK};font-weight:600;text-decoration:none;">${SITE.phone}</a>.`)}
  </td></tr>

  <!-- While you wait -->
  <tr><td style="padding:12px 40px 30px;">
    <div style="height:1px;background:${BORDER};font-size:0;line-height:0;margin:0 0 26px;">&nbsp;</div>
    ${eyebrow("While you wait")}
    <p style="margin:0 0 4px;font-family:${FONT_HEADING};font-size:18px;font-weight:700;color:${INK};">${c.primary.title}</p>
    <p style="margin:0 0 16px;font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${MUTED};">${c.primary.body}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
      <tr><td style="background:${ORANGE};border-radius:6px;">
        <a href="${escapeHtml(c.primary.href)}" style="display:inline-block;padding:12px 22px;font-family:${FONT_BODY};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${c.primary.cta}</a>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${c.links.map(linkRow).join("\n      ")}
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:${STEEL};border-radius:0 0 ${RADIUS} ${RADIUS};padding:22px 40px;">
    <p style="margin:0 0 6px;font-family:${FONT_HEADING};font-size:14px;font-weight:700;color:#ffffff;">${SITE.name} <span style="font-family:${FONT_BODY};font-weight:400;color:#d6e0ea;">· ${SITE.descriptor}</span></p>
    <p style="margin:0 0 8px;font-family:${FONT_BODY};font-size:13px;line-height:1.7;color:#ffffff;">
      <a href="${tel}" style="color:#ffffff;text-decoration:none;">${SITE.phone}</a> &nbsp;·&nbsp;
      <a href="mailto:${SITE.email}" style="color:#ffffff;text-decoration:none;">${SITE.email}</a> &nbsp;·&nbsp;
      <a href="${base}" style="color:#ffffff;text-decoration:none;">ausdilaps.com.au</a>
    </p>
    <p style="margin:0;font-family:${FONT_BODY};font-size:12px;line-height:1.6;color:#c9d5e1;">${SITE.legalName} T/A ${SITE.name} · ABN ${SITE.abn} · ${SITE.address}</p>
  </td></tr>

</table>

</td></tr>
</table>
</body>
</html>`;

  const strip = (s: string) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&rarr;/g, "->")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

  const text = [
    c.headline,
    "",
    `${strip(greeting)},`,
    "",
    ...c.intro.map(strip).flatMap((p) => [p, ""]),
    ...(c.steps.length > 0
      ? [c.stepsHeading.toUpperCase(), ...c.steps.map((s, i) => `${i + 1}. ${s.title} — ${strip(s.body)}`), ""]
      : []),
    `If it's urgent, call us on ${SITE.phone}.`,
    "",
    "WHILE YOU WAIT",
    `${c.primary.title}: ${c.primary.href}`,
    ...c.links.map((l) => `${l.title}: ${l.href}`),
    "",
    `${SITE.name} · ${SITE.descriptor}`,
    `${SITE.phone} · ${SITE.email} · ${base}`,
    `${SITE.legalName} T/A ${SITE.name} · ABN ${SITE.abn} · ${SITE.address}`,
  ].join("\n");

  return { subject: c.subject, html, text };
}
