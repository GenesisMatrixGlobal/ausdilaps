import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { StatTiles, type Stat } from "@/components/staff/stat-tiles";
import {
  apiLabel,
  dollars,
  loadApiUsage,
  toolTitle,
  unitLabel,
  unitPriceCents,
  type UsageMonth,
  type UsageRow,
} from "@/lib/admin/api-usage";

export const metadata = {
  title: "API usage · AusDilaps Admin",
  robots: { index: false, follow: false },
};

/**
 * What the staff tools are spending on Google Maps Platform, Anthropic and Deepgram, month by
 * month, split by tool and by API — with a total, and with each tool opening to show which APIs
 * its money went on. Counted by us at the point of each call (lib/api-usage.ts). Anthropic and
 * Deepgram are exact at list (the tokens and audio seconds each response reported). Google is
 * list price for the requests PAST each API's free monthly allowance, which is what the invoice
 * should show; the list-price figure before the allowance is shown alongside so the value of
 * the free tier is visible. The invoice is the truth — compare once a month.
 *
 * ?month=2026-08 shows any past month against the one before it. ?tool=<slug> opens that
 * tool's breakdown — the in-tool counters link here with it (components/tools/shared/tool-spend).
 */

const PROVIDER_LABEL: Record<string, string> = {
  google: "Google Maps",
  anthropic: "Anthropic",
  deepgram: "Deepgram",
  arcgis: "State cadastre",
};

type Agg = { calls: number; units: number; cents: number; listCents: number };

function byKey<K extends string>(rows: UsageRow[], key: (r: UsageRow) => K): Map<K, Agg> {
  const out = new Map<K, Agg>();
  for (const r of rows) {
    const k = key(r);
    const cur = out.get(k) ?? { calls: 0, units: 0, cents: 0, listCents: 0 };
    out.set(k, { calls: cur.calls + r.calls, units: cur.units + r.units, cents: cur.cents + r.costCents, listCents: cur.listCents + r.listCents });
  }
  return out;
}

/** Keys of both months, this month's biggest spender first. */
function orderedKeys<K extends string>(now: Map<K, Agg>, prev: Map<K, Agg>): K[] {
  return [...new Set([...now.keys(), ...prev.keys()])].sort(
    (a, b) => (now.get(b)?.cents ?? 0) - (now.get(a)?.cents ?? 0) || (now.get(b)?.calls ?? 0) - (now.get(a)?.calls ?? 0)
  );
}

function fmtUnits(n: number): string {
  return n.toLocaleString("en-AU");
}

/** One tool, opening to the APIs its spend went on. */
function ToolSection({ slug, month, lastMonth, open }: { slug: string; month: UsageMonth; lastMonth: UsageMonth; open: boolean }) {
  const rowsNow = month.rows.filter((r) => (r.tool ?? "") === slug);
  const rowsPrev = lastMonth.rows.filter((r) => (r.tool ?? "") === slug);
  const now = byKey(rowsNow, (r) => `${r.provider}|${r.api}`);
  const prev = byKey(rowsPrev, (r) => `${r.provider}|${r.api}`);
  const keys = orderedKeys(now, prev);
  const total = (m: Map<string, Agg>) => [...m.values()].reduce((s, a) => ({ calls: s.calls + a.calls, cents: s.cents + a.cents }), { calls: 0, cents: 0 });
  const tNow = total(now);
  const tPrev = total(prev);
  return (
    <details id={`tool-${slug || "unattributed"}`} open={open} className="group border-t border-ad-border/60">
      <summary className="grid cursor-pointer grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-6 px-4 py-2.5 text-sm hover:bg-ad-surface/50 [&::-webkit-details-marker]:hidden">
        <span className="text-ad-ink">
          <span className="mr-2 inline-block w-3 text-ad-muted transition-transform group-open:rotate-90">›</span>
          {toolTitle(slug || null)}
          <span className="ml-2 text-xs text-ad-muted">{keys.length} API{keys.length === 1 ? "" : "s"}</span>
        </span>
        <span className="tabular-nums text-ad-ink">{tNow.calls}</span>
        <span className="tabular-nums font-medium text-ad-ink">{dollars(tNow.cents)}</span>
        <span className="tabular-nums text-ad-muted">{tPrev.calls ? dollars(tPrev.cents) : "—"}</span>
      </summary>
      <table className="w-full bg-ad-surface/40 text-sm">
        <tbody>
          {keys.map((k) => {
            const [provider, api] = k.split("|") as [string, string];
            const n = now.get(k);
            const p = prev.get(k);
            return (
              <tr key={k} className="border-t border-ad-border/40">
                <td className="py-1.5 pl-12 pr-4 text-ad-ink">
                  {apiLabel(provider, api)}
                  <span className="ml-2 text-xs text-ad-muted">{PROVIDER_LABEL[provider] ?? provider}</span>
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums text-ad-muted">
                  {n ? `${fmtUnits(n.units)} ${unitLabel(provider, api, n.units)}` : "—"}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums text-ad-ink">{n?.calls ?? 0}</td>
                <td className="px-4 py-1.5 text-right tabular-nums text-ad-ink">{dollars(n?.cents ?? 0)}</td>
                <td className="px-4 py-1.5 text-right tabular-nums text-ad-muted">{p ? dollars(p.cents) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}

function ByTool({ month, lastMonth, openTool }: { month: UsageMonth; lastMonth: UsageMonth; openTool: string | null }) {
  const now = byKey(month.rows, (r) => r.tool ?? "");
  const prev = byKey(lastMonth.rows, (r) => r.tool ?? "");
  const keys = orderedKeys(now, prev);
  return (
    <section className="rounded-xl border border-ad-border bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold text-ad-ink">By tool</h2>
        <p className="text-xs text-ad-muted">Which tool the browser was on when it made the call. Open a tool to see which APIs its spend went on.</p>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-6 border-t border-ad-border px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ad-muted">
        <span>Tool</span>
        <span className="text-right">Calls</span>
        <span className="text-right">{month.label}</span>
        <span className="text-right">{lastMonth.label}</span>
      </div>
      {keys.length === 0 && <p className="border-t border-ad-border px-4 py-6 text-center text-sm text-ad-muted">Nothing recorded yet.</p>}
      {keys.map((k) => (
        <ToolSection key={k} slug={k} month={month} lastMonth={lastMonth} open={openTool !== null && k === openTool} />
      ))}
      {keys.length > 0 && (
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-6 border-t border-ad-border bg-ad-surface/60 px-4 py-2.5 text-sm font-medium">
          <span className="text-ad-ink">Total</span>
          <span className="tabular-nums text-ad-ink">{month.totalCalls}</span>
          <span className="tabular-nums text-ad-ink">{dollars(month.totalCents)}</span>
          <span className="tabular-nums text-ad-muted">{dollars(lastMonth.totalCents)}</span>
        </div>
      )}
    </section>
  );
}

function ByApi({ month, lastMonth }: { month: UsageMonth; lastMonth: UsageMonth }) {
  const now = byKey(month.rows, (r) => `${r.provider}|${r.api}`);
  const prev = byKey(lastMonth.rows, (r) => `${r.provider}|${r.api}`);
  const keys = orderedKeys(now, prev);
  return (
    <section className="rounded-xl border border-ad-border bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold text-ad-ink">By API</h2>
        <p className="text-xs text-ad-muted">Cost after each API&apos;s free monthly allowance; list price per unit shown for reference.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-t border-ad-border text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-ad-muted">
              <th className="px-4 py-2">API</th>
              <th className="px-4 py-2 text-right">Each</th>
              <th className="px-4 py-2 text-right">Units</th>
              <th className="px-4 py-2 text-right">Calls</th>
              <th className="px-4 py-2 text-right">{month.label}</th>
              <th className="px-4 py-2 text-right text-ad-muted">{lastMonth.label}</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ad-muted">Nothing recorded yet.</td>
              </tr>
            )}
            {keys.map((k) => {
              const [provider, api] = k.split("|") as [string, string];
              const n = now.get(k);
              const p = prev.get(k);
              const each = unitPriceCents(provider, api);
              return (
                <tr key={k} className="border-t border-ad-border/60">
                  <td className="px-4 py-2 text-ad-ink">
                    {apiLabel(provider, api)}
                    <span className="ml-2 text-xs text-ad-muted">{PROVIDER_LABEL[provider] ?? provider}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ad-muted">{each === null ? "—" : each === 0 ? "free" : `${each}c`}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ad-muted">{n ? `${fmtUnits(n.units)} ${unitLabel(provider, api, n.units)}` : "—"}</td>
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
                <td />
                <td />
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

export default async function ApiUsagePage({ searchParams }: { searchParams: Promise<{ month?: string; tool?: string }> }) {
  await requireAdmin("/admin/usage");
  const params = await searchParams;
  const u = await loadApiUsage(params.month);
  const { month, lastMonth } = u;
  const openTool = params.tool ?? null;

  // One tile per provider that spent anything in either month — Google and Anthropic always,
  // so a month with no spend still shows them at $0.00 rather than vanishing.
  const providers = [...new Set(["google", "anthropic", ...month.rows.map((r) => r.provider), ...lastMonth.rows.map((r) => r.provider)])].filter(
    (p) => p !== "arcgis"
  );
  const providerSpend = (rows: UsageRow[], p: string) => rows.filter((r) => r.provider === p).reduce((s, r) => s + r.costCents, 0);
  const providerList = (rows: UsageRow[], p: string) => rows.filter((r) => r.provider === p).reduce((s, r) => s + r.listCents, 0);
  const tiles: Stat[] = [
    { label: `Spend · ${month.label}`, value: dollars(month.totalCents), sub: `${month.totalCalls} calls · ${dollars(month.totalListCents)} at list before free tiers` },
    { label: `Spend · ${lastMonth.label}`, value: dollars(lastMonth.totalCents), sub: `${lastMonth.totalCalls} calls` },
    ...providers.map((p): Stat => ({
      label: PROVIDER_LABEL[p] ?? p,
      value: dollars(providerSpend(month.rows, p)),
      sub:
        p === "google"
          ? `after 10,000 free requests per API · ${dollars(providerList(month.rows, p))} at list`
          : p === "anthropic"
            ? "from the tokens each call reported"
            : p === "deepgram"
              ? "audio minutes at list, rounded up"
              : `${dollars(providerSpend(lastMonth.rows, p))} last month`,
    })),
  ];
  const columns = (Math.min(6, Math.max(3, tiles.length)) as 3 | 4 | 5 | 6);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ad-ink">API usage</h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ad-muted">
        What the staff tools spend on Google Maps Platform, Anthropic and Deepgram, counted at each call. Anthropic and
        Deepgram are exact at list, from what each response reported. Google is list price for the requests past each
        API&apos;s 10,000 free per month — the number the invoice should show — with the before-allowance figure
        alongside. Months are Brisbane calendar months; check against the invoice once.
      </p>

      {/* Month navigation. Any month against the one before it, not only this one against last. */}
      <nav className="mt-6 flex items-center gap-3 text-sm" aria-label="Month">
        <Link href={`/admin/usage?month=${u.prevKey}${openTool ? `&tool=${encodeURIComponent(openTool)}` : ""}`} className="rounded-full border border-ad-border px-3 py-1 text-ad-ink hover:bg-ad-surface">
          ← {lastMonth.label}
        </Link>
        <span className="font-medium text-ad-ink">{month.label}</span>
        {u.nextKey ? (
          <Link href={`/admin/usage?month=${u.nextKey}${openTool ? `&tool=${encodeURIComponent(openTool)}` : ""}`} className="rounded-full border border-ad-border px-3 py-1 text-ad-ink hover:bg-ad-surface">
            Next →
          </Link>
        ) : (
          <span className="text-xs text-ad-muted">current month, to date</span>
        )}
      </nav>

      {u.unavailable && (
        <div className="mt-6 rounded-xl border border-ad-amber-line bg-ad-amber-tint px-4 py-3">
          <p className="text-sm font-medium text-ad-ink">Usage data unavailable</p>
          <p className="mt-0.5 text-xs text-ad-muted">{u.unavailable}</p>
        </div>
      )}

      <div className="mt-6">
        <StatTiles stats={tiles} columns={columns} />
      </div>

      <div className="mt-8 space-y-6">
        <ByTool month={month} lastMonth={lastMonth} openTool={openTool} />
        <ByApi month={month} lastMonth={lastMonth} />
      </div>
    </div>
  );
}
