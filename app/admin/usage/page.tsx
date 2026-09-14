import { requireAdmin } from "@/lib/auth/session";
import { StatTiles, type Stat } from "@/components/staff/stat-tiles";
import { apiLabel, dollars, loadApiUsage, toolTitle, unitPriceCents, type UsageMonth, type UsageRow } from "@/lib/admin/api-usage";

export const metadata = {
  title: "API usage · AusDilaps Admin",
  robots: { index: false, follow: false },
};

/**
 * What the staff tools are spending on Google Maps Platform and Anthropic, this month and
 * last, split by tool and by API — with a total. Counted by us at the point of each call
 * (lib/api-usage.ts), priced at list, so it is an ESTIMATE and a ceiling: Google's monthly
 * free allowance per API is not applied, and the invoice is the truth.
 */

function byKey<K extends string>(rows: UsageRow[], key: (r: UsageRow) => K) {
  const out = new Map<K, { calls: number; cents: number }>();
  for (const r of rows) {
    const k = key(r);
    const cur = out.get(k) ?? { calls: 0, cents: 0 };
    out.set(k, { calls: cur.calls + r.calls, cents: cur.cents + r.costCents });
  }
  return out;
}

function Table({
  title,
  hint,
  month,
  lastMonth,
  groupBy,
  label,
  each,
}: {
  title: string;
  hint: string;
  month: UsageMonth;
  lastMonth: UsageMonth;
  groupBy: (r: UsageRow) => string;
  label: (k: string) => string;
  each?: (k: string) => string | null;
}) {
  const now = byKey(month.rows, groupBy);
  const prev = byKey(lastMonth.rows, groupBy);
  const keys = [...new Set([...now.keys(), ...prev.keys()])].sort(
    (a, b) => (now.get(b)?.cents ?? 0) - (now.get(a)?.cents ?? 0) || (now.get(b)?.calls ?? 0) - (now.get(a)?.calls ?? 0)
  );
  return (
    <section className="rounded-xl border border-ad-border bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold text-ad-ink">{title}</h2>
        <p className="text-xs text-ad-muted">{hint}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-t border-ad-border text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-ad-muted">
              <th className="px-4 py-2">{title === "By tool" ? "Tool" : "API"}</th>
              {each && <th className="px-4 py-2 text-right">Each</th>}
              <th className="px-4 py-2 text-right">Calls</th>
              <th className="px-4 py-2 text-right">{month.label}</th>
              <th className="px-4 py-2 text-right text-ad-muted">{lastMonth.label}</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr>
                <td colSpan={each ? 5 : 4} className="px-4 py-6 text-center text-ad-muted">
                  Nothing recorded yet.
                </td>
              </tr>
            )}
            {keys.map((k) => {
              const n = now.get(k);
              const p = prev.get(k);
              const unit = each?.(k);
              return (
                <tr key={k} className="border-t border-ad-border/60">
                  <td className="px-4 py-2 text-ad-ink">{label(k)}</td>
                  {each && <td className="px-4 py-2 text-right tabular-nums text-ad-muted">{unit ?? "—"}</td>}
                  <td className="px-4 py-2 text-right tabular-nums text-ad-ink">{n?.calls ?? 0}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium text-ad-ink">{dollars(n?.cents ?? 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ad-muted">{p ? dollars(p.cents) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          {keys.length > 0 && (
            <tfoot>
              <tr className="border-t border-ad-border bg-ad-surface/60 font-medium">
                <td className="px-4 py-2 text-ad-ink">Total</td>
                {each && <td />}
                <td className="px-4 py-2 text-right tabular-nums text-ad-ink">{month.totalCalls}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ad-ink">{dollars(month.totalCents)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ad-muted">{dollars(lastMonth.totalCents)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

export default async function ApiUsagePage() {
  await requireAdmin("/admin/usage");
  const u = await loadApiUsage();
  const { month, lastMonth } = u;

  const tiles: Stat[] = [
    { label: `Spend · ${month.label}`, value: dollars(month.totalCents), sub: `${month.totalCalls} calls · estimate at list price` },
    { label: `Spend · ${lastMonth.label}`, value: dollars(lastMonth.totalCents), sub: `${lastMonth.totalCalls} calls` },
    {
      label: "Google share",
      value: dollars(month.rows.filter((r) => r.provider === "google").reduce((s, r) => s + r.costCents, 0)),
      sub: "Maps Platform, before the free allowance",
    },
    {
      label: "Anthropic share",
      value: dollars(month.rows.filter((r) => r.provider === "anthropic").reduce((s, r) => s + r.costCents, 0)),
      sub: "from the tokens each call reported",
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ad-ink">API usage</h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ad-muted">
        What the staff tools spend on Google Maps Platform and Anthropic, counted at each call and priced at list. An
        estimate and a ceiling: Google&apos;s monthly free allowance per API is not applied here, so the invoice will
        read lower. Months are Brisbane calendar months.
      </p>

      {u.unavailable && (
        <div className="mt-6 rounded-xl border border-ad-amber-line bg-ad-amber-tint px-4 py-3">
          <p className="text-sm font-medium text-ad-ink">Usage data unavailable</p>
          <p className="mt-0.5 text-xs text-ad-muted">{u.unavailable}</p>
        </div>
      )}

      <div className="mt-8">
        <StatTiles stats={tiles} columns={4} />
      </div>

      <div className="mt-8 space-y-6">
        <Table
          title="By tool"
          hint="Which tool the browser was on when it made the call. Jobs with no page are named."
          month={month}
          lastMonth={lastMonth}
          groupBy={(r) => r.tool ?? ""}
          label={(k) => toolTitle(k || null)}
        />
        <Table
          title="By API"
          hint="List price per request. Anthropic is priced from the tokens each response reported."
          month={month}
          lastMonth={lastMonth}
          groupBy={(r) => `${r.provider}|${r.api}`}
          label={(k) => apiLabel(...(k.split("|") as [string, string]))}
          each={(k) => {
            const c = unitPriceCents(...(k.split("|") as [string, string]));
            return c === null ? null : c === 0 ? "free" : `${c}c`;
          }}
        />
      </div>
    </div>
  );
}
