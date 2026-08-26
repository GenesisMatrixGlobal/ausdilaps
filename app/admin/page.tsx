import Link from "next/link";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth/session";
import { loadDashboard, type Alert } from "@/lib/admin/dashboard";
import { StatTiles, type Stat } from "@/components/staff/stat-tiles";
import { MetricRow } from "@/components/staff/metric-row";
import { Sparkline } from "@/components/staff/sparkline";
import { Pill } from "@/components/staff/pill";

/**
 * The GM's dashboard.
 *
 * Ordered by how likely each section is to make someone act, not by how interesting it is
 * to look at. The attention strip is first and usually invisible; that is the point.
 *
 * Scope: what came IN. Outcomes — won, lost, pipeline value — are Salesforce's job.
 */

export const metadata = {
  title: "Admin · AusDilaps",
  robots: { index: false, follow: false },
};

const GA4_URL = "https://analytics.google.com/analytics/web/";

function relative(iso: string | null, now: number): string {
  if (!iso) return "never";
  const hours = (now - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)} hr${Math.floor(hours) === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ad-ink">{title}</h2>
        {hint && <p className="text-xs text-ad-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function AttentionStrip({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="mb-8 space-y-2">
      {alerts.map((a) => (
        <div
          key={a.title}
          className={`rounded-lg border border-ad-border border-l-[3px] p-3.5 ${
            a.tone === "critical" ? "border-l-ad-orange bg-ad-orange/5" : "border-l-ad-orange/60 bg-ad-orange/[0.03]"
          }`}
        >
          <p className="text-sm font-semibold text-ad-ink">{a.title}</p>
          <p className="mt-0.5 max-w-[80ch] text-xs leading-relaxed text-ad-muted">
            {a.detail}
            {a.href && (
              <>
                {" "}
                <Link href={a.href} className="font-medium text-ad-steel hover:underline">
                  Take a look →
                </Link>
              </>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}

export default async function AdminHomePage() {
  await requireAdmin("/admin");

  // PageSpeed needs an absolute origin, and it must be the deployed one — measuring
  // localhost would score a dev build with no caching or minification.
  const host = (await headers()).get("host") ?? "";
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (host.startsWith("localhost") ? "https://ausdilaps.vercel.app" : `https://${host}`);

  const d = await loadDashboard(origin);
  const { enquiries: e, staff, tools } = d;

  const delta = e.thisWeek - e.lastWeek;
  const tiles: Stat[] = [
    {
      label: "Enquiries this week",
      value: e.thisWeek,
      sub:
        e.lastWeek === 0 && e.thisWeek === 0
          ? "none last week either"
          : `${delta >= 0 ? "+" : ""}${delta} vs last week`,
      tone: delta > 0 ? "ok" : delta < 0 ? "warn" : "default",
    },
    {
      label: "Tier-1 this week",
      value: e.tier1ThisWeek,
      sub: "estimated from role & company",
    },
    {
      label: "Enquiries · 30d",
      value: e.last30,
      sub: e.daysSinceLast === null ? "none yet" : `last one ${e.daysSinceLast} day${e.daysSinceLast === 1 ? "" : "s"} ago`,
      tone: e.daysSinceLast !== null && e.daysSinceLast >= 14 ? "warn" : "default",
    },
    {
      label: "Tool uses · 7d",
      value: tools.usedThisWeek,
      sub: `${tools.usedLast30} in the last 30 days`,
    },
    {
      label: "Staff active · 7d",
      value: staff.activeThisWeek,
      sub: `of ${staff.active} active account${staff.active === 1 ? "" : "s"}`,
      tone: staff.neverSignedIn > 0 ? "warn" : "default",
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ad-ink">Admin</h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ad-muted">
        Enquiry volume, portal usage and anything that needs attention. Lead outcomes live in Salesforce.
      </p>

      {d.unavailable && (
        <div className="mt-6 rounded-lg border border-ad-orange/40 bg-ad-orange/5 p-4">
          <p className="text-sm font-semibold text-ad-ink">Dashboard data unavailable</p>
          <p className="mt-1 text-xs text-ad-muted">{d.unavailable}</p>
        </div>
      )}

      <div className="mt-8">
        <AttentionStrip alerts={d.alerts} />
        <StatTiles stats={tiles} columns={5} />
      </div>

      <Section title="Enquiries · last 12 weeks" hint={`${e.total90} in the last 90 days`}>
        <div className="rounded-xl border border-ad-border bg-white p-4">
          <Sparkline
            points={e.trend.map((t) => t.count)}
            label={`Enquiries per week over the last 12 weeks, ending at ${e.thisWeek}`}
          />
          <div className="mt-1 flex justify-between text-[0.7rem] tabular-nums text-ad-muted">
            <span>12 weeks ago</span>
            <span>this week</span>
          </div>
        </div>
      </Section>

      <Section title="What people are asking for" hint="last 90 days">
        <MetricRow metrics={e.byType.map((b) => ({ label: b.label, value: b.count }))} />
      </Section>

      <Section
        title="Job size and client type"
        hint="Tier is estimated by keyword — treat it as a signal, not a fact"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-medium text-ad-muted">By number of properties</p>
            <MetricRow
              metrics={e.bySize.map((b) => ({ label: b.label, value: b.count, emphasis: b.label === "100+" }))}
              className="sm:grid-cols-3 lg:grid-cols-3"
            />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-ad-muted">By client tier</p>
            <MetricRow
              metrics={e.byTier.map((b) => ({ label: b.label, value: b.count, emphasis: b.label === "tier1" }))}
              className="sm:grid-cols-4 lg:grid-cols-4"
            />
          </div>
        </div>
      </Section>

      <Section title="Which pages bring enquiries" hint="the SEO payoff, measured">
        {e.bySource.length === 0 ? (
          <p className="text-sm text-ad-muted">No enquiries recorded yet.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-ad-border">
            {e.bySource.map((s) => (
              <div
                key={s.label}
                className="flex items-center justify-between gap-4 border-b border-ad-border bg-white px-4 py-2.5 last:border-b-0"
              >
                <code className="truncate text-xs text-ad-ink">{s.label}</code>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ad-ink">{s.count}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Who's using the portal" hint="Per-tool usage is on the Tools tab">
        {staff.rows.length === 0 ? (
          <p className="text-sm text-ad-muted">No staff accounts yet.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-ad-border">
            {staff.rows.map((s) => (
              <div
                key={s.name}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-ad-border bg-white px-4 py-2.5 last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ad-ink">{s.name}</span>
                  <Pill tone="muted">{s.role}</Pill>
                </div>
                {s.lastSeenAt ? (
                  <span className="text-xs text-ad-muted">Last seen {relative(s.lastSeenAt, d.now)}</span>
                ) : (
                  <Pill tone="warn">Never signed in</Pill>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Site health" hint="Google's own scores, refreshed daily">
        <div className="grid gap-3 sm:grid-cols-2">
          {d.pageSpeed.length === 0 ? (
            <p className="text-sm text-ad-muted">
              Not measured yet — the first check runs in the background and appears here shortly.
            </p>
          ) : (
            d.pageSpeed.map((p) => (
              <div key={p.url} className="rounded-xl border border-ad-border bg-white p-4">
                <p className="text-sm font-semibold text-ad-ink">{p.label}</p>
                {p.error ? (
                  <p className="mt-1 text-xs text-ad-orange">Couldn&rsquo;t measure: {p.error}</p>
                ) : (
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {[
                      ["Speed", p.performance],
                      ["A11y", p.accessibility],
                      ["SEO", p.seo],
                      ["Practices", p.bestPractices],
                    ].map(([label, score]) => (
                      <div key={label as string}>
                        <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-ad-muted">{label}</p>
                        <p
                          className={`text-lg font-semibold tabular-nums ${
                            score === null
                              ? "text-ad-muted"
                              : (score as number) >= 90
                                ? "text-ad-steel"
                                : (score as number) >= 50
                                  ? "text-ad-orange"
                                  : "text-ad-orange"
                          }`}
                        >
                          {score === null ? "—" : score}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        <p className="mt-3 text-xs text-ad-muted">
          Traffic and visitor numbers live in{" "}
          <a href={GA4_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-ad-steel hover:underline">
            Google Analytics →
          </a>
        </p>
      </Section>
    </div>
  );
}
