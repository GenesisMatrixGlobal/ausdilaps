import { safeExternalUrl, safeText, stripHeaderChars } from "@/lib/html";
import { SERVICE_LABELS, type ServiceKey } from "./profile";

/**
 * The nightly digest — the product.
 *
 * Most weeks nobody opens the portal; they decide from this email. So it carries the full
 * summary and reasoning per match, not just titles and a link.
 *
 * It is deliberately NOT the original tender email forwarded on. A forwarded portal email
 * is attacker-controlled HTML arriving from our own DKIM-signed domain into a manager's
 * inbox — a convincing place to put a fake "Approve bid" button. We render our own summary
 * and link out instead, which also makes the RSS and email paths produce identical output.
 *
 * Every interpolation goes through safeText(); every link through safeExternalUrl(), whose
 * hostname is rendered as plain text beside the link so a human sees `evil-tenders.ru`
 * before they click. Model- and sender-supplied text is never used as a link label.
 */

export type DigestItem = {
  id: string;
  title: string;
  agency: string | null;
  url: string | null;
  closesAt: string | null;
  relevance: "match" | "maybe";
  confidence: number | null;
  services: string[];
  summary: string | null;
  reasoning: string | null;
  sourceLabel: string;
  senderTrusted: boolean;
  injectionSuspected: boolean;
};

export type DigestAlert = { sourceLabel: string; message: string };

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
  // keeps the digest sending rather than shipping broken links in an otherwise good email.
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://ausdilaps.com.au").replace(/\/$/, "");
}

function formatCloses(iso: string | null): string | null {
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

function renderItem(item: DigestItem): string {
  const link = safeExternalUrl(item.url);
  const closes = formatCloses(item.closesAt);
  const isMatch = item.relevance === "match";
  const pillColour = isMatch ? BRAND.steel : BRAND.orange;
  const pillLabel = isMatch ? "Match" : "Review";
  const pct = item.confidence === null ? "" : ` · ${Math.round(item.confidence * 100)}%`;

  const services = item.services
    .filter((s): s is ServiceKey => s in SERVICE_LABELS)
    .map((s) => SERVICE_LABELS[s])
    .join(" · ");

  // The title is only a link when the URL survived validation; otherwise it stays plain
  // text. We never fabricate an href to make the layout look consistent.
  const heading = link
    ? `<a href="${link.href}" style="color:${BRAND.steel};text-decoration:none">${safeText(item.title, 200)}</a>`
    : safeText(item.title, 200);

  const facts = [
    item.agency ? safeText(item.agency, 120) : null,
    closes ? safeText(closes, 60) : null,
    link ? `<span style="font-family:monospace;font-size:11px">${link.host}</span>` : null,
  ]
    .filter(Boolean)
    .join(" &middot; ");

  const badges = [
    !item.senderTrusted ? "Unverified sender" : null,
    item.injectionSuspected ? "Flagged content" : null,
  ]
    .filter(Boolean)
    .map(
      (b) =>
        `<span style="display:inline-block;font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:${BRAND.orange};background:#fdeee7;border-radius:4px;padding:2px 6px;margin-right:4px">${b}</span>`
    )
    .join("");

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND.border};border-radius:8px;margin-bottom:12px">
    <tr><td style="padding:14px 16px">
      <div style="font-size:15px;font-weight:600;color:${BRAND.ink};margin-bottom:4px">${heading}</div>
      <div style="font-size:12px;color:${BRAND.muted};margin-bottom:8px">${facts}</div>
      ${badges ? `<div style="margin-bottom:8px">${badges}</div>` : ""}
      <div style="font-size:13px;color:${BRAND.ink};margin-bottom:8px">${safeText(item.summary, 400)}</div>
      <div style="font-size:12px;color:${BRAND.muted};border-left:2px solid ${BRAND.steel};padding-left:10px;margin-bottom:10px">
        <b style="color:${BRAND.ink}">Why:</b> ${safeText(item.reasoning, 800)}
      </div>
      <span style="display:inline-block;font-size:11px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:${pillColour}">${pillLabel}${pct}</span>
      ${services ? `<span style="font-size:11px;color:${BRAND.muted}"> &nbsp;&middot;&nbsp; ${safeText(services, 120)}</span>` : ""}
    </td></tr>
  </table>`;
}

export function renderDigest(opts: {
  items: DigestItem[];
  alerts: DigestAlert[];
  scanned: number;
  sources: number;
}): { subject: string; html: string } {
  const matches = opts.items.filter((i) => i.relevance === "match").length;
  const reviews = opts.items.length - matches;

  const parts = [
    matches > 0 ? `${matches} match${matches === 1 ? "" : "es"}` : null,
    reviews > 0 ? `${reviews} to review` : null,
  ].filter(Boolean);
  const headline = parts.length ? parts.join(", ") : "Source check";

  const alertHtml = opts.alerts.length
    ? `<div style="border-left:3px solid ${BRAND.orange};background:#fdeee7;border-radius:6px;padding:11px 13px;font-size:12px;color:${BRAND.ink};margin-bottom:14px">
         ${opts.alerts
           .map((a) => `<div><b>${safeText(a.sourceLabel, 80)}:</b> ${safeText(a.message, 200)}</div>`)
           .join("")}
       </div>`
    : "";

  const today = new Date().toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Australia/Brisbane",
  });

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px 12px;background:${BRAND.surface};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid ${BRAND.border};border-radius:10px;overflow:hidden">
    <tr><td style="background:${BRAND.navyDeep};padding:20px 22px">
      <div style="font-size:11px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:${BRAND.steelLight};margin-bottom:5px">Nightly scan &middot; ${today}</div>
      <div style="font-size:18px;font-weight:600;color:#ffffff">${headline}</div>
      <div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:6px">${opts.scanned} tender${opts.scanned === 1 ? "" : "s"} scanned across ${opts.sources} source${opts.sources === 1 ? "" : "s"}.</div>
    </td></tr>
    <tr><td style="padding:20px 22px">
      ${alertHtml}
      ${opts.items.map(renderItem).join("")}
      <div style="text-align:center;margin:18px 0 4px">
        <a href="${siteUrl()}/staff/accounts/tools/tender-watch" style="display:inline-block;background:${BRAND.orange};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 24px;border-radius:7px">Open Tender Watch</a>
      </div>
    </td></tr>
    <tr><td style="padding:16px 22px;border-top:1px solid ${BRAND.border};background:${BRAND.surface};font-size:11px;color:${BRAND.muted}">
      One email a night, only when there is something in it.<br>AusDilaps &middot; Specialist Building Inspections
    </td></tr>
  </table>
</body></html>`;

  return { subject: stripHeaderChars(`Tender Watch — ${headline}`), html };
}

/**
 * Sends the digest. Returns false on any failure — the caller leaves forwarded_at null so
 * the partial index sweeps those items out on the next run.
 *
 * Note this deliberately differs from sendEmails() in app/api/quote/route.ts, which
 * returns silently when RESEND_API_KEY is unset. Silent non-delivery is the exact failure
 * this feature exists to prevent, so a missing key is logged loudly and makes the run
 * report `partial` rather than `succeeded`.
 */
export async function sendDigest(opts: {
  items: DigestItem[];
  alerts: DigestAlert[];
  scanned: number;
  sources: number;
  testMode: boolean;
}): Promise<{ sent: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    const error = "RESEND_API_KEY not configured";
    console.error(`[tenders] ${error} — ${opts.items.length} item(s) not delivered`);
    return { sent: false, error };
  }

  const from = process.env.RESEND_FROM_EMAIL ?? "AusDilaps <no-reply@ausdilaps.com.au>";
  const adminEmail = process.env.ADMIN_EMAIL ?? "info@ausdilaps.com.au";
  const to = opts.testMode
    ? [adminEmail]
    : (process.env.TENDER_NOTIFY_EMAIL ?? adminEmail)
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

  if (to.length === 0) return { sent: false, error: "No recipients configured" };

  const { subject, html } = renderDigest(opts);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // Closes the duplicate window opened by send-then-mark: a replayed send returns the
        // original message rather than delivering twice.
        "Idempotency-Key": `tender-digest:${new Date().toISOString().slice(0, 10)}:${opts.items.length}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject: opts.testMode ? `[TEST] ${subject}` : subject,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const error = `Resend ${res.status}: ${body.slice(0, 200)}`;
      console.error(`[tenders] digest send failed: ${error}`);
      return { sent: false, error };
    }

    return { sent: true };
  } catch (e) {
    const error = (e as Error).message;
    console.error("[tenders] digest send failed:", error);
    return { sent: false, error };
  }
}
