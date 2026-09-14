import { requireAdmin } from "@/lib/auth/session";
import { loadLeads, type LeadRecord } from "@/lib/admin/leads";

export const metadata = {
  title: "Enquiries · AusDilaps Admin",
  robots: { index: false, follow: false },
};

/**
 * What came in through the quote form, newest first.
 *
 * One expandable row per enquiry rather than a wide table: the form has eighteen fields and
 * which of them are filled depends on the enquiry type, so a column per field would be
 * mostly empty cells. The row carries what you scan for — who, when, what kind — and opens
 * to the rest. Native <details>, so it works with no JavaScript and prints.
 *
 * Read-only. `leads.status` is in the schema and this app has never written it; outcomes
 * live in Salesforce.
 */

const TIER_LABEL: Record<string, string> = {
  tier1: "Tier 1",
  tier2: "Tier 2",
  residential: "Residential",
  unclassified: "Unclassified",
};

function when(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Brisbane",
  }).format(new Date(iso));
}

/** Whether the notice to info@ got out, as one glyph you can scan a column of.
 *
 *  ⚠️ "Sent" means Resend ACCEPTED it, not that it landed in the inbox — a later bounce is
 *  invisible to us. The wording says sent, never delivered, on purpose.
 *
 *  Null is drawn as a muted dash, NOT as a failure: rows created before the send was
 *  recorded have nothing to report, and colouring them amber would invent alarms. */
function SendMark({ ok, what }: { ok: boolean | null; what: string }) {
  if (ok === null) {
    return (
      <span className="text-ad-muted/40" title={`${what} — not recorded`} aria-label={`${what} not recorded`}>
        –
      </span>
    );
  }
  return ok ? (
    <span className="text-ad-green" title={`Sent to ${what}`} aria-label={`Sent to ${what}`}>
      ✓
    </span>
  ) : (
    <span
      className="font-semibold text-ad-amber"
      title={`FAILED to send to ${what}`}
      aria-label={`Failed to send to ${what}`}
    >
      ✕
    </span>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-ad-muted">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-ad-ink">{value}</dd>
    </div>
  );
}

function LeadRow({ lead }: { lead: LeadRecord }) {
  const detail = [
    { label: "Role", value: lead.role },
    { label: "Company", value: lead.company },
    { label: "Project", value: lead.projectName },
    { label: "Location", value: lead.projectLocation },
    { label: "Approx. assets", value: lead.assetCount },
    { label: "Property role", value: lead.propertyRole },
    { label: "Project / OPT number", value: lead.projectNumber },
    { label: "Document ID", value: lead.documentId },
    { label: "Their address", value: lead.contactAddress },
    { label: "Preferred contact", value: lead.contactMethod?.join(", ") || null },
    { label: "Came from", value: lead.sourcePage },
  ].filter((f) => f.value);

  return (
    <details className="group border-b border-ad-border last:border-b-0">
      <summary className="flex cursor-pointer list-none items-baseline gap-3 px-4 py-3 hover:bg-ad-surface/60 sm:px-5">
        <span
          aria-hidden
          className="mt-1 shrink-0 text-[0.6rem] text-ad-muted transition-transform group-open:rotate-90"
        >
          ▶
        </span>
        {/* First thing in the row, so a column of them scans in one pass. */}
        <span className="mt-0.5 w-4 shrink-0 text-center text-sm leading-none">
          <SendMark ok={lead.emailed} what="info@ausdilaps.com.au" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-heading text-[0.95rem] font-semibold text-ad-ink">
              {lead.name}
            </span>
            {lead.company && <span className="text-sm text-ad-muted">· {lead.company}</span>}
            {lead.tier && lead.tier !== "unclassified" && (
              <span className="rounded-full bg-ad-surface px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-ad-steel">
                {TIER_LABEL[lead.tier] ?? lead.tier}
              </span>
            )}
            {/* The glyph at the head of the row is the at-a-glance signal; this spells it
                out for the one case that needs words. */}
            {lead.emailed === false && (
              <span className="rounded-full bg-ad-amber-tint px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-ad-amber">
                info@ not notified
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-ad-muted">
            {lead.inquiryType ?? "Enquiry"} · {when(lead.createdAt)}
          </span>
        </span>
        <span className="hidden shrink-0 text-right text-xs sm:block">
          {/* No onClick to stop the summary toggling — this is a server component, and a
              handler here would not run. Clicking the address opens the mail client and
              also expands the row, which is harmless. */}
          <a href={`mailto:${lead.email}`} className="block text-ad-steel hover:underline">
            {lead.email}
          </a>
          {lead.phone && (
            <a
              href={`tel:${lead.phone.replace(/\s/g, "")}`}
              className="block text-ad-muted hover:underline"
            >
              {lead.phone}
            </a>
          )}
        </span>
      </summary>

      <div className="border-t border-ad-border bg-ad-surface/40 px-4 py-4 sm:px-5">
        {/* Repeated inside the panel because they are hidden in the summary on a phone. */}
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Email" value={lead.email} />
          <Field label="Phone" value={lead.phone} />
          {detail.map((f) => (
            <Field key={f.label} label={f.label} value={f.value} />
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-ad-border pt-3">
          <p className="flex items-center gap-1.5 text-xs text-ad-muted">
            <SendMark ok={lead.emailed} what="info@ausdilaps.com.au" />
            Notice to info@ausdilaps.com.au
          </p>
          <p className="flex items-center gap-1.5 text-xs text-ad-muted">
            <SendMark ok={lead.ackEmailed} what={lead.email} />
            Acknowledgement to the enquirer
          </p>
        </div>
        {lead.notes && (
          <div className="mt-4 border-t border-ad-border pt-3">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-ad-muted">
              Notes
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ad-ink">
              {lead.notes}
            </p>
          </div>
        )}
      </div>
    </details>
  );
}

export default async function AdminLeadsPage() {
  await requireAdmin("/admin/leads");
  const { leads, total, unavailable } = await loadLeads();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ad-ink">Enquiries</h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ad-muted">
        Everything submitted through the quote form, newest first. The tick means the notice
        reached info@ausdilaps.com.au; a cross means it did not and nobody was told. Click a
        row for every field it carried. Enquiries are not synced to Salesforce.
      </p>

      {unavailable && (
        <div className="mt-6 rounded-xl border border-ad-amber-line bg-ad-amber-tint px-4 py-3">
          <p className="text-sm text-ad-ink">{unavailable}</p>
        </div>
      )}

      {!unavailable && leads.length === 0 ? (
        <p className="mt-8 rounded-xl border border-ad-border bg-white px-4 py-6 text-sm text-ad-muted">
          Nothing yet. A submission through{" "}
          <a href="/quote" className="font-medium text-ad-steel hover:underline">
            the quote form
          </a>{" "}
          shows up here straight away.
        </p>
      ) : (
        <>
          <div className="mt-8 overflow-hidden rounded-xl border border-ad-border bg-white">
            {leads.map((lead) => (
              <LeadRow key={lead.id} lead={lead} />
            ))}
          </div>
          <p className="mt-3 text-xs text-ad-muted">
            {leads.length === total
              ? `${total} enquir${total === 1 ? "y" : "ies"}`
              : `Showing the latest ${leads.length} of ${total}`}
          </p>
        </>
      )}
    </div>
  );
}
