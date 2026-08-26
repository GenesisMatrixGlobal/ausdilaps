import Link from "next/link";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth/session";
import { loadDashboard, type Alert } from "@/lib/admin/dashboard";
import { StatTiles, type Stat } from "@/components/staff/stat-tiles";
import { MetricRow } from "@/components/staff/metric-row";
import { Sparkline } from "@/components/staff/sparkline";
import { ComingSoon } from "@/components/staff/coming-soon";

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

      <Section
        title="Not connected yet"
        hint="Each one lists what's standing in the way"
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <ComingSoon
            title="Search rankings"
            what="Where we rank for the terms the whole site is built to win — and whether that's moving. Impressions, clicks and average position per query."
            needs={[
              "Enable the Google Search Console API",
              "A service account, added as a user on the Search Console property",
            ]}
          />
          <ComingSoon
            title="Website traffic"
            what="Visits, top landing pages and where people come from. Pairs with enquiries to give a conversion rate per page."
            needs={[
              "Enable the Google Analytics Data API",
              "A service account with Viewer on the GA4 property",
              "The numeric Property ID (not G-81JV6BQ2R5)",
            ]}
          />
          <ComingSoon
            title="Tender pipeline"
            what="Tenders scanned, matches found and what was sent on. Built and tested — deliberately switched off."
            needs={[
              "A tender feed URL (verify it in a browser first)",
              "A CRON_SECRET of at least 32 characters",
              'Restore the cron block in vercel.json (currently "crons": [])',
            ]}
            docs="docs/tender-watch.md"
          />
        </div>
      </Section>

    </div>
  );
}
