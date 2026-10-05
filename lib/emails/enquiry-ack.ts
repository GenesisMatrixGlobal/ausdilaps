/**
 * The acknowledgement email a visitor gets after the enquiry form.
 *
 * Pure: no Next, no env, no network — `app/api/quote/route.ts` hands it the input and the
 * site URL, and `npm run check:ack` renders every branch headlessly. The content is per
 * ENQUIRY TYPE (Rhys, 2026-10-05: a resident who got an access letter and a contracts
 * administrator wanting a quote are asking completely different questions, and one dry
 * "thanks for your enquiry" served neither), with a "while you wait" block that points at
 * something worth their time: the sample reports, the capability statement, the FAQ.
 *
 * Every fact in here comes from lib/site.ts, data/faq.ts or content/insights — the
 * methodology steps, the "two to four hours" inspection figure, the AS 4349.0 reference.
 * Don't add a claim you can't point at.
 *
 * ⚠️ The recipient is whoever typed the address, so everything reflected back (name,
 * project, address, references) goes through `escapeHtml`, and the greeting falls back to
 * "Hi there" when the first name looks like a URL or an email — this is a DKIM-signed
 * message from us to a stranger, so a linkified name is a free phishing lure.
 *
 * Email HTML, not web HTML: tables, inline styles, system fonts, absolute image URLs. The
 * logo is `${siteUrl}/logo/ad-logo.png` — the SAME committed file the site header uses, not
 * a data URI (Gmail strips those) and not a Resend attachment.
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
  /** A still-configured samples access code, so the samples link opens straight into the
   *  library. The form already captured the name and email the gate would ask for, so
   *  this hands them nothing they couldn't get by typing the same details again. */
  samplesCode?: string;
};

type Link = { title: string; body: string; href: string; cta: string };

type Content = {
  headline: string;
  subject: string;
  /** Paragraphs, already escaped. */
  intro: string[];
  /** "What happens next" steps, already escaped. */
  steps: { title: string; body: string }[];
  /** The orange button. */
  primary: Link;
  /** The rest of "while you wait". */
  links: Link[];
};

// Brand tokens from app/globals.css — repeated here because an email can't load a stylesheet.
const INK = "#2f343a";
const MUTED = "#5b6570";
const STEEL = "#46688a";
const ORANGE = "#e8642a";
const SURFACE = "#f3f4f5";
const BORDER = "#e3e5e8";
const DEEP = "#23272b";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const trimSlash = (u: string) => u.replace(/\/+$/, "");

/** How a chosen contact method reads mid-sentence ("by SMS or phone"). */
const CONTACT_WORD: Record<ContactMethod, string> = { SMS: "SMS", Call: "phone", Email: "email" };

function greetingFor(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  if (!first || /[/:@\\<>]/.test(first) || first.length > 30) return "Hi there";
  return `Hi ${escapeHtml(first)}`;
}

function contentFor(d: QuoteInput, siteUrl: string, samplesCode?: string): Content {
  const samplesHref = samplesCode
    ? `${siteUrl}${SAMPLES_PATH}?code=${encodeURIComponent(samplesCode)}`
    : `${siteUrl}${SAMPLES_PATH}`;
  const samples: Link = {
    title: "See a finished report",
    body: "Sample reports across residential, commercial and infrastructure jobs.",
    href: samplesHref,
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
    body: "What's inspected, who arranges it, how long it takes.",
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
            ? `Thanks for the details on <strong>${project.join(", ")}</strong>. An estimator is reviewing the scope now.`
            : "Thanks for the details. An estimator is reviewing the scope now.",
        ],
        steps: [
          { title: "Desktop review", body: "Site, adjoining properties, DA conditions." },
          { title: "Itemised quote", body: "Clear pricing, methodology and deliverables." },
          { title: "Kick-off", body: "A project coordinator confirms access and scheduling." },
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
            ? `Thanks for getting in touch about <strong>${escapeHtml(d.contactAddress)}</strong>. Our projects team will be in touch shortly.`
            : "Thanks for getting in touch. Our projects team will be in touch shortly.",
          "In short: a construction project near you has engaged us to record the condition of nearby properties before work starts. The report is an independent photographic record of your property, so there's a clear baseline if anything changes during the works.",
        ],
        steps: [
          {
            title: "We arrange a time",
            body: d.contactMethod?.length
              ? `By ${d.contactMethod.map((m) => CONTACT_WORD[m]).join(" or ")}, at a time that suits you.`
              : "At a time that suits you.",
          },
          { title: "The inspection", body: "Interior and exterior photos. A standard home takes two to four hours." },
          { title: "The record", body: `A report to ${SITE.standard}, your baseline for the rest of the project.` },
        ],
        primary: whatIs,
        links: [faq, samples],
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
        steps: [],
        primary: faq,
        links: [samples, capability],
      };
    }

    case "General Inquiry":
    default:
      return {
        subject: "We've received your enquiry — AusDilaps",
        headline: "Thanks for getting in touch.",
        intro: ["We've got your enquiry and the right person will come back to you shortly."],
        steps: [],
        primary: samples,
        links: [capability, faq],
      };
  }
}

export function enquiryAckEmail({ input, siteUrl, samplesCode }: AckInput): AckEmail {
  const base = trimSlash(siteUrl);
  const c = contentFor(input, base, samplesCode);
  const greeting = greetingFor(input.name);
  const logo = `${base}/logo/ad-logo.png`;

  const para = (s: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:${INK};">${s}</p>`;

  const stepsHtml =
    c.steps.length === 0
      ? ""
      : `<p style="margin:28px 0 12px;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${STEEL};">What happens next</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${c.steps
  .map(
    (s, i) => `<tr>
  <td valign="top" style="width:36px;padding:0 0 12px;"><div style="width:26px;height:26px;border-radius:13px;background:${STEEL};color:#ffffff;font-size:13px;font-weight:700;line-height:26px;text-align:center;">${i + 1}</div></td>
  <td valign="top" style="padding:3px 0 14px;font-size:15px;line-height:1.4;color:${INK};"><strong>${s.title}</strong> <span style="color:${MUTED};">— ${s.body}</span></td>
</tr>`
  )
  .join("\n")}
</table>`;

  const linkCard = (l: Link) => `<tr>
  <td style="padding:0 0 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid ${BORDER};border-radius:6px;">
      <tr>
        <td style="padding:13px 18px;font-size:15px;font-weight:700;color:${INK};">${l.title}<span style="display:block;font-size:13px;font-weight:400;color:${MUTED};margin-top:2px;">${l.body}</span></td>
        <td align="right" valign="middle" style="padding:13px 18px;white-space:nowrap;"><a href="${escapeHtml(l.href)}" style="font-size:14px;font-weight:700;color:${STEEL};text-decoration:none;">${l.cta} &rarr;</a></td>
      </tr>
    </table>
  </td>
</tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(c.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${SURFACE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(c.headline)} Here's what happens next.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SURFACE};">
<tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;font-family:${FONT};">

  <!-- Header -->
  <tr><td style="background:#ffffff;border-radius:8px 8px 0 0;padding:28px 36px 22px;border-bottom:3px solid ${STEEL};">
    <a href="${base}" style="text-decoration:none;"><img src="${logo}" width="168" height="62" alt="AusDilaps — Specialist Building Inspections" style="display:block;width:168px;height:auto;border:0;"></a>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#ffffff;padding:32px 36px 8px;">
    <h1 style="margin:0 0 18px;font-size:24px;line-height:1.3;font-weight:700;color:${INK};">${escapeHtml(c.headline)}</h1>
    ${para(`${greeting},`)}
    ${c.intro.map(para).join("\n    ")}
    ${stepsHtml}
    ${para(`If it's urgent, call us on <a href="tel:${SITE.phone.replace(/\s+/g, "")}" style="color:${INK};font-weight:700;text-decoration:none;">${SITE.phone}</a> or just reply to this email.`)}
  </td></tr>

  <!-- While you wait -->
  <tr><td style="background:${SURFACE};border-top:1px solid ${BORDER};padding:26px 36px 18px;">
    <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${STEEL};">While you wait</p>
    <p style="margin:0 0 14px;font-size:17px;font-weight:700;color:${INK};">${c.primary.title} <span style="font-weight:400;color:${MUTED};">· ${c.primary.body}</span></p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
      <tr><td style="background:${ORANGE};border-radius:4px;">
        <a href="${escapeHtml(c.primary.href)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">${c.primary.cta}</a>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${c.links.map(linkCard).join("\n      ")}
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:${DEEP};border-radius:0 0 8px 8px;padding:24px 36px;">
    <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#ffffff;">${SITE.name} <span style="font-weight:400;color:#9aa5b1;">· ${SITE.descriptor}</span></p>
    <p style="margin:0 0 10px;font-size:13px;line-height:1.7;color:#c3cad2;">
      <a href="tel:${SITE.phone.replace(/\s+/g, "")}" style="color:#ffffff;text-decoration:none;">${SITE.phone}</a> &nbsp;·&nbsp;
      <a href="mailto:${SITE.email}" style="color:#ffffff;text-decoration:none;">${SITE.email}</a> &nbsp;·&nbsp;
      <a href="${base}" style="color:#ffffff;text-decoration:none;">ausdilaps.com.au</a>
    </p>
    <p style="margin:0;font-size:12px;line-height:1.6;color:#8a94a0;">${SITE.legalName} T/A ${SITE.name} · ABN ${SITE.abn} · ${SITE.address}</p>
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
      ? ["WHAT HAPPENS NEXT", ...c.steps.map((s, i) => `${i + 1}. ${s.title} — ${strip(s.body)}`), ""]
      : []),
    `If it's urgent, call us on ${SITE.phone} or reply to this email.`,
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
