import Link from "next/link";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth/session";
import { loadDashboard, type Alert, type Breakdown } from "@/lib/admin/dashboard";
import { StatTiles, type Stat } from "@/components/staff/stat-tiles";
import { Sparkline } from "@/components/staff/sparkline";
import { ComingSoon } from "@/components/staff/coming-soon";
import { ASSET_COUNT_RANGES } from "@/lib/leads";

/**
 * The GM's dashboard.
 *
 * Reading order is the design: what needs attention → the week's numbers → detail →
 * what isn't connected yet. The attention band is first and usually invisible; that is
 * the point.
 *
 * Scope: what came IN. Outcomes — won, lost, pipeline value — are Salesforce's job.
 */

export const metadata = {
  title: "Admin · AusDilaps",
  robots: { index: false, follow: false },
};

const GA4_URL = "https://analytics.google.com/analytics/web/";

const TIERS = ["tier1", "tier2", "residential", "unclassified"] as const;
const TIER_LABELS: Record<string, string> = {
  tier1: "Tier 1",
  tier2: "Tier 2",
  residential: "Residential",
  unclassified: "Unclassified",
};

/** Section heading. Content is passed pre-wrapped so each panel can size itself. */
function Section({
  title,
  hint,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-ad-ink">{title}</h2>
        {hint && <p className="text-xs text-ad-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const Panel = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`overflow-hidden rounded-xl border border-ad-border bg-white ${className}`}>
    {children}
  </div>
);

/**
 * Everything that wants a human is amber, in one panel, one line each.
 *
 * No red tier. Nothing this dashboard can detect is an outage — a missing API key or a
 * stale invite is "sort this out today", not "stop what you're doing". Reserving red keeps
 * it meaningful for the day something genuinely is broken.
 */
function AttentionPanel({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-ad-amber-line bg-ad-amber-tint">
      <p className="border-b border-ad-amber-line px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ad-amber">
        Needs a look · {alerts.length}
      </p>
      {alerts.map((a) => (
        <div
          key={a.title}
          className="flex gap-2 border-b border-ad-amber-line/60 px-4 py-2.5 last:border-b-0"
        >
          <span aria-hidden className="mt-[0.4rem] shrink-0 text-[0.5rem] text-ad-amber">
            ●
          </span>
          {/* Title above detail until there is genuinely room for one line. Side by side on
              a phone squeezed the detail into a one-word-per-line column. */}
          <div className="min-w-0 flex-1 lg:flex lg:items-baseline lg:gap-2">
            <p className="text-sm font-medium text-ad-ink lg:shrink-0">{a.title}</p>
            <p className="mt-0.5 min-w-0 text-xs leading-relaxed text-ad-muted lg:mt-0">
              {a.detail}
              {a.href && (
                <>
                  {" "}
                  <Link
                    href={a.href}
                    className="font-medium whitespace-nowrap text-ad-steel hover:underline"
                  >
                    Take a look →
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * One compact figure in the enquiry mix.
 *
 * Zeros are rendered, not dropped. Hiding empty categories is what made the old breakdown
 * look broken — a single lonely card floating beside a "nothing recorded yet" message.
 * "Tier 1: 0" is information; a missing Tier 1 column is just confusing.
 */
function Figure({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <p
        className="truncate text-[0.65rem] font-semibold uppercase tracking-wide text-ad-muted"
        title={label}
      >
        {label}
      </p>
      <p
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          value === 0 ? "text-ad-muted/50" : emphasis ? "text-ad-steel" : "text-ad-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/** Fills in categories with no rows so the mix always renders the same shape. */
function withZeros(found: Breakdown[], all: readonly string[]) {
  const map = new Map(found.map((b) => [b.label, b.count]));
  return all.map((label) => ({ label, count: map.get(label) ?? 0 }));
}

function ScoreRow({ label, scores, error }: {
  label: string;
  scores: readonly (readonly [string, number | null])[];
  error?: string;
}) {
  return (
    <div className="border-b border-ad-border px-4 py-3 last:border-b-0">
      <p className="text-sm font-medium text-ad-ink">{label}</p>
      {error ? (
        <p className="mt-1 text-xs text-ad-amber">{error}</p>
      ) : (
        <div className="mt-2 flex gap-6">
          {scores.map(([name, score]) => (
            <div key={name}>
              <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-ad-muted">{name}</p>
              <p
                className={`text-base font-semibold tabular-nums ${
                  score === null ? "text-ad-muted/50" : score >= 90 ? "text-ad-steel" : "text-ad-amber"
                }`}
              >
                {score ?? "—"}
              </p>
            </div>
          ))}
        </div>
      )}
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
    { label: "Tier-1 this week", value: e.tier1ThisWeek, sub: "estimated from role & company" },
    {
      label: "Enquiries · 30d",
      value: e.last30,
      sub:
        e.daysSinceLast === null
          ? "none yet"
          : `last one ${e.daysSinceLast} day${e.daysSinceLast === 1 ? "" : "s"} ago`,
      tone: e.daysSinceLast !== null && e.daysSinceLast >= 14 ? "warn" : "default",
    },
    { label: "Tool uses · 7d", value: tools.usedThisWeek, sub: `${tools.usedLast30} in the last 30 days` },
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
        <div className="mt-6 rounded-xl border border-ad-amber-line bg-ad-amber-tint px-4 py-3">
          <p className="text-sm font-medium text-ad-ink">Dashboard data unavailable</p>
          <p className="mt-0.5 text-xs text-ad-muted">{d.unavailable}</p>
        </div>
      )}

      <div className="mt-8 space-y-6">
        <AttentionPanel alerts={d.alerts} />
        <StatTiles stats={tiles} columns={5} />
      </div>

      {/* Two columns from lg up. Enquiries takes the wider one because the trend line needs
          the room; site health is a short list of numbers and doesn't. */}
      <div className="mt-10 grid items-start gap-6 lg:grid-cols-3">
        <Section title="Enquiries" hint={`${e.total90} in the last 90 days`} className="lg:col-span-2">
          <Panel>
            <div className="px-4 pb-3 pt-4">
              <Sparkline
                points={e.trend.map((t) => t.count)}
                label={`Enquiries per week over the last 12 weeks, ending at ${e.thisWeek}`}
              />
              <div className="mt-1 flex justify-between text-[0.7rem] text-ad-muted">
                <span>12 weeks ago</span>
                <span>this week</span>
              </div>
            </div>

            {/* The mix, folded in rather than given its own section. As its own heading it
                wrapped two sub-headings and a grid of cards around a single number. */}
            <div className="grid border-t border-ad-border sm:grid-cols-2">
              <div className="border-b border-ad-border px-4 py-3 sm:border-b-0 sm:border-r">
                <p className="mb-2 text-[0.7rem] text-ad-muted">
                  By client tier <span className="opacity-70">· estimated, treat as a signal</span>
                </p>
                <div className="grid grid-cols-2 gap-3 min-[420px]:grid-cols-4">
                  {withZeros(e.byTier, TIERS).map((b) => (
                    <Figure
                      key={b.label}
                      label={TIER_LABELS[b.label] ?? b.label}
                      value={b.count}
                      emphasis={b.label === "tier1"}
                    />
                  ))}
                </div>
              </div>

              <div className="px-4 py-3">
                <p className="mb-2 text-[0.7rem] text-ad-muted">By number of properties</p>
                <div className="grid grid-cols-3 gap-3">
                  {withZeros(e.bySize, ASSET_COUNT_RANGES).map((b) => (
                    <Figure key={b.label} label={b.label} value={b.count} emphasis={b.label === "100+"} />
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        </Section>

        <Section title="Site health" hint="Google's scores, daily">
          <Panel>
            {d.pageSpeed.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ad-muted">
                Not measured yet — the first check runs in the background.
              </p>
            ) : (
              d.pageSpeed.map((p) => (
                <ScoreRow
                  key={p.url}
                  label={p.label}
                  error={p.error && `Couldn't measure — ${p.error}`}
                  scores={[
                    ["Speed", p.performance],
                    ["A11y", p.accessibility],
                    ["SEO", p.seo],
                    ["Practices", p.bestPractices],
                  ] as const}
                />
              ))
            )}
            <div className="border-t border-ad-border px-4 py-2.5">
              <a
                href={GA4_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-ad-steel hover:underline"
              >
                Traffic &amp; visitors in Google Analytics →
              </a>
            </div>
          </Panel>
        </Section>
      </div>

      <Section title="Not connected yet" hint="each lists what's standing in the way" className="mt-10">
        <div className="grid gap-3 md:grid-cols-3">
          <ComingSoon
            title="Search rankings"
            what="Where we rank for the terms the whole site is built to win, and whether that's moving."
            needs={[
              "Enable the Google Search Console API",
              "A service account, added as a user on the property",
            ]}
          />
          <ComingSoon
            title="Website traffic"
            what="Visits, top landing pages and sources. Pairs with enquiries to give a conversion rate per page."
            needs={[
              "Enable the Google Analytics Data API",
              "A service account with Viewer on GA4",
              "The numeric Property ID (not G-81JV6BQ2R5)",
            ]}
          />
          <ComingSoon
            title="Tender pipeline"
            what="Tenders scanned, matches found and what was sent on. Built and tested — deliberately switched off."
            needs={[
              "A tender feed URL (check it in a browser first)",
              "A CRON_SECRET of 32+ characters",
              'Restore the cron block in vercel.json (now "crons": [])',
            ]}
            docs="docs/tender-watch.md"
          />
        </div>
      </Section>
    </div>
  );
}
