import { createHash } from "node:crypto";
import { safeExternalUrl, safeText, stripHeaderChars } from "@/lib/html";
import { SERVICE_LABELS, type ServiceKey } from "./profile";

/**
 * The handoff email — the product.
 *
 * This replaced an automatic nightly digest. That version built the same email unattended
 * and needed three env vars (TENDER_FORWARD_ENABLED, TENDER_FORWARD_UNTRUSTED and a
 * trusted-sender list) whose only job was to make unsupervised sending safe. A person
 * ticking a box is a better gate than all three, so they are gone and this is sent on
 * demand from the tool.
 *
 * That changes what the email is FOR. It is no longer "here is what the robot found, you
 * decide" — the deciding already happened. It is a work order: these opportunities have been
 * checked and need adding to the portal. So it carries the details needed to act (agency,
 * closing date, link, what the job is) and drops the classifier's reasoning, which was only
 * ever there to help a reader triage.
 *
 * It is deliberately NOT the original portal email forwarded on. A forwarded portal email is
 * attacker-controlled HTML arriving from our own DKIM-signed domain into a manager's inbox —
 * a convincing place to put a fake "Approve bid" button. We render our own summary and link
 * out instead.
 *
 * Every interpolation goes through safeText(); every link through safeExternalUrl(), whose
 * hostname is rendered as plain text beside the link so a human sees `evil-tenders.ru`
 * before they click. Model- and sender-supplied text is never used as a link label.
 */

/** One place the same opportunity arrived from. */
export type HandoffSource = { label: string; url: string | null };

/**
 * One opportunity — a GROUP of rows, not a row.
 *
 * The same tender reaches us up to five times (portal reminders, an internal forward), so
 * `ids` is every member row the send should mark, and `seenCount` is what the email shows
 * instead of repeating the job five times.
 */
export type HandoffItem = {
  ids: string[];
  title: string;
  agency: string | null;
  siteLocation: string | null;
  contact: string | null;
  closesAt: string | null;
  relevance: "match" | "maybe";
  confidence: number | null;
  services: string[];
  summary: string | null;
  seenCount: number;
  sources: HandoffSource[];
  senderTrusted: boolean;
  injectionSuspected: boolean;
};

const BRAND = {
  ink: "#2f343a",
  steel: "#46688a",
  steelLight: "#6d90b4",
  orange: "#e8642a",
  navyDeep: "#23272b",
  muted: "#5b6570",
  border: "#e3e5e7",
  surface: "#f3f4f5",
};

function siteUrl(): string {
  // NEXT_PUBLIC_SITE_URL is currently missing from Vercel (CLAUDE.md §10). Falling back
  // keeps the email sending rather than shipping broken links in an otherwise good one.
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://ausdilaps.com.au").replace(/\/$/, "");
}

/** `email:felix.net` reads as machinery; "felix.net" is what a person calls it. */
export function prettySource(slug: string): string {
  return slug.replace(/^email:/, "").replace(/^rss:/, "");
}

export function formatCloses(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  const label = date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "Australia/Brisbane",
  });
  if (days < 0) return `Closed ${label}`;
  if (days <= 14) return `Closes ${label} · ${days} day${days === 1 ? "" : "s"}`;
  return `Closes ${label}`;
}

/**
 * A closing date inside a fortnight gets the orange treatment.
 *
 * The single most actionable fact in this email is which of these runs out first — one of
 * the current queue closes in two days. Sorting alone does not carry that; colour does.
 */
function closesUrgently(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const days = Math.ceil((t - Date.now()) / 86_400_000);
  return days >= 0 && days <= 14;
}

function renderItem(item: HandoffItem, index: number): string {
  const primary = item.sources.find((s) => s.url) ?? null;
  const link = safeExternalUrl(primary?.url ?? null);
  const closes = formatCloses(item.closesAt);
  const urgent = closesUrgently(item.closesAt);

  const services = item.services
    .filter((s): s is ServiceKey => s in SERVICE_LABELS)
    .map((s) => SERVICE_LABELS[s])
    .join(" · ");

  // The title is only a link when the URL survived validation; otherwise it stays plain
  // text. We never fabricate an href to make the layout look consistent.
  const heading = link
    ? `<a href="${link.href}" style="color:${BRAND.steel};text-decoration:none">${safeText(item.title, 200)}</a>`
    : safeText(item.title, 200);

  // One fact per LINE, not a single ` · `-joined run.
  //
  // This email is now the whole job — read it, create the Salesforce record, done — so it is
  // read as a form to copy from rather than a headline to skim. A joined run of
  // "agency · location · closes · host" is fine when the reader is only deciding whether to
  // click through, and useless when they are transcribing four fields out of it.
  const rows: [string, string][] = [];
  if (item.agency) rows.push(["Client", safeText(item.agency, 160)]);
  if (item.siteLocation) rows.push(["Address", safeText(item.siteLocation, 200)]);
  if (closes)
    rows.push([
      "Closes",
      `<span style="color:${urgent ? BRAND.orange : BRAND.ink};font-weight:${urgent ? 600 : 400}">${safeText(closes, 60)}</span>`,
    ]);
  if (item.contact) rows.push(["Contact", safeText(item.contact, 200)]);
  rows.push([
    "Portal",
    link
      ? // The hostname in plain text beside the link: escaping an href stops injection, it
        // does not stop navigation, and a reader should see where a link goes before
        // clicking. Same reasoning as the tool's own rows.
        `<a href="${link.href}" style="color:${BRAND.steel}">Open the notice</a> <span style="font-family:monospace;font-size:11px;color:${BRAND.muted}">${link.host}</span>`
      : // No link, and none invented. A direct email invitation genuinely has no portal —
        // the only URL we hold is Graph's deep link into the tenders@ mailbox, which nobody
        // else can open. Saying so, and naming who sent it, is the useful answer.
        `<span style="color:${BRAND.muted}">Invitation by email${item.contact ? ` — reply to ${safeText(item.contact, 120)}` : ""}</span>`,
  ]);

  const factRows = rows
    .map(
      ([label, value]) => `<tr>
        <td style="padding:2px 10px 2px 0;font-size:11px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:${BRAND.muted};white-space:nowrap;vertical-align:top">${label}</td>
        <td style="padding:2px 0;font-size:13px;color:${BRAND.ink}">${value}</td>
      </tr>`
    )
    .join("");

  const badges = [
    item.relevance === "maybe" ? "Was flagged for review" : null,
    !item.senderTrusted ? "Unverified sender" : null,
    item.injectionSuspected ? "Flagged content" : null,
  ]
    .filter(Boolean)
    .map(
      (b) =>
        `<span style="display:inline-block;font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:${BRAND.orange};background:#fdeee7;border-radius:4px;padding:2px 6px;margin-right:4px">${b}</span>`
    )
    .join("");

  // Only shown when the job genuinely arrived more than once — otherwise it is noise on
  // every single card. The extra links are listed so a reader can reach the copy they
  // recognise, rather than trusting our pick of a primary.
  const alsoFrom =
    item.seenCount > 1
      ? `<div style="font-size:11px;color:${BRAND.muted};margin-top:8px;padding-top:8px;border-top:1px dashed ${BRAND.border}">
           Arrived ${item.seenCount} times &middot; ${safeText(item.sources.map((s) => prettySource(s.label)).join(", "), 200)}
         </div>`
      : "";

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND.border};border-radius:8px;margin-bottom:12px">
    <tr><td style="padding:14px 16px">
      <div style="font-size:15px;font-weight:600;color:${BRAND.ink};margin-bottom:4px">
        <span style="color:${BRAND.muted};font-weight:400">${index + 1}.</span> ${heading}
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 10px">${factRows}</table>
      ${badges ? `<div style="margin-bottom:8px">${badges}</div>` : ""}
      <div style="font-size:13px;color:${BRAND.ink}">${safeText(item.summary, 400)}</div>
      ${services ? `<div style="font-size:11px;color:${BRAND.muted};margin-top:8px">${safeText(services, 120)}</div>` : ""}
      ${alsoFrom}
    </td></tr>
  </table>`;
}

export function renderHandoff(opts: {
  items: HandoffItem[];
  note?: string | null;
  sentBy?: string | null;
}): { subject: string; html: string } {
  const n = opts.items.length;
  const headline = `${n} opportunit${n === 1 ? "y" : "ies"} to convert inside Salesforce`;

  // Soonest deadline first. A dated tender always outranks an undated one, whatever its
  // confidence — the thing that makes an opportunity urgent is the clock, not the model.
  const items = [...opts.items].sort((a, b) => {
    const at = a.closesAt ? new Date(a.closesAt).getTime() : Infinity;
    const bt = b.closesAt ? new Date(b.closesAt).getTime() : Infinity;
    if (at !== bt) return at - bt;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  const note = opts.note?.trim()
    ? `<div style="border-left:3px solid ${BRAND.steel};background:${BRAND.surface};border-radius:6px;padding:11px 13px;font-size:13px;color:${BRAND.ink};margin-bottom:16px">
         ${safeText(opts.note, 600)}
       </div>`
    : "";

  const today = new Date().toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Australia/Brisbane",
  });

  const attribution = opts.sentBy
    ? `Reviewed and sent by ${safeText(opts.sentBy, 120)}.`
    : "Reviewed and sent from Tender Watch.";

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px 12px;background:${BRAND.surface};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid ${BRAND.border};border-radius:10px;overflow:hidden">
    <tr><td style="background:${BRAND.navyDeep};padding:20px 22px">
      <div style="font-size:11px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:${BRAND.steelLight};margin-bottom:5px">Tender Watch &middot; ${today}</div>
      <div style="font-size:18px;font-weight:600;color:#ffffff">${headline}</div>
      <div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:6px">Everything needed to raise each one is below — soonest deadline first. No need to open Tender Watch.</div>
    </td></tr>
    <tr><td style="padding:20px 22px">
      ${note}
      ${items.map(renderItem).join("")}
    </td></tr>
    <tr><td style="padding:16px 22px;border-top:1px solid ${BRAND.border};background:${BRAND.surface};font-size:11px;color:${BRAND.muted}">
      ${attribution} <a href="${siteUrl()}/staff/accounts/tools/tender-watch" style="color:${BRAND.muted}">Open Tender Watch</a><br>AusDilaps &middot; Specialist Building Inspections
    </td></tr>
  </table>
</body></html>`;

  return { subject: stripHeaderChars(`Tender Watch — ${headline}`), html };
}

/**
 * Sends the handoff. Returns `sent: false` on any failure rather than throwing — the caller
 * leaves forwarded_at null so the items stay in the queue and can simply be sent again.
 *
 * Note this deliberately differs from sendEmails() in app/api/quote/route.ts, which returns
 * silently when RESEND_API_KEY is unset. Silent non-delivery is the exact failure this
 * feature exists to prevent, so a missing key is logged loudly and surfaced to the operator.
 */
export async function sendHandoff(opts: {
  items: HandoffItem[];
  note?: string | null;
  sentBy?: string | null;
  testMode?: boolean;
  /**
   * Send to one address instead of the team, for a dry run.
   *
   * ⚠️ The CALLER must derive this from the signed-in session, never from a request body.
   * An arbitrary recipient on an endpoint that renders our own tender pipeline into a
   * DKIM-signed email is a data-exfiltration primitive; "send it to my own address" is not.
   * See app/api/tenders/send/route.ts, which passes user.email and nothing else.
   */
  onlyTo?: string | null;
}): Promise<{ sent: boolean; error?: string; id?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    const error = "RESEND_API_KEY not configured";
    console.error(`[tenders] ${error} — ${opts.items.length} opportunity(s) not delivered`);
    return { sent: false, error };
  }

  const from = process.env.RESEND_FROM_EMAIL ?? "AusDilaps <no-reply@ausdilaps.com.au>";
  const adminEmail = process.env.ADMIN_EMAIL ?? "info@ausdilaps.com.au";
  const dryRun = !!opts.onlyTo;
  const to = dryRun
    ? [opts.onlyTo!]
    : opts.testMode
      ? [adminEmail]
      : (process.env.TENDER_NOTIFY_EMAIL ?? adminEmail)
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean);

  if (to.length === 0) return { sent: false, error: "No recipients configured" };

  const { subject, html } = renderHandoff(opts);
  const prefix = dryRun ? "[TEST TO YOURSELF] " : opts.testMode ? "[TEST] " : "";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // Keyed on WHAT is being sent, not on the day and a count.
        //
        // The retired digest used `tender-digest:<date>:<item count>`, which collided with
        // itself: any two sends of the same number of items on the same day were treated as
        // one, and Resend silently returned the first message instead of delivering the
        // second. A double-clicked button must not send twice, but two genuinely different
        // selections of three tenders must both arrive — so the key is a hash of the ids.
        "Idempotency-Key": `${dryRun ? "dryrun:" : ""}${idempotencyKey(opts.items)}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject: `${prefix}${subject}`,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const error = `Resend ${res.status}: ${body.slice(0, 200)}`;
      console.error(`[tenders] handoff send failed: ${error}`);
      return { sent: false, error };
    }

    const json = (await res.json().catch(() => null)) as { id?: string } | null;
    return { sent: true, id: json?.id };
  } catch (e) {
    const error = (e as Error).message;
    console.error(`[tenders] handoff send failed: ${error}`);
    return { sent: false, error };
  }
}

/** Sorted so selection order cannot change the key, then hashed to a fixed length. */
export function idempotencyKey(items: HandoffItem[]): string {
  const ids = items.flatMap((i) => i.ids).sort();
  return `tender-handoff:${createHash("sha1").update(ids.join(",")).digest("hex")}`;
}
