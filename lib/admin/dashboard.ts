import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadToolUsage } from "@/lib/tools/usage";
import { loadPageSpeed, PAGESPEED_TARGETS, type PageSpeedScore } from "@/lib/pagespeed";
import { INQUIRY_TYPES, ASSET_COUNT_RANGES } from "@/lib/leads";

/**
 * Everything /admin renders, in one call.
 *
 * Mirrors lib/tenders/summary.ts: feature-detects Supabase, returns an `unavailable`
 * message instead of throwing, and does every query in a single Promise.all so the page
 * pays one round trip to Sydney rather than one per panel.
 *
 * Scope note: this reports what came IN — enquiry volume, mix, and whether anything went
 * missing on the way. It says nothing about outcomes. Status, won/lost and pipeline value
 * are Salesforce's job, and leads.status is never written by this app.
 */

const DAY = 86_400_000;
const WEEK = 7 * DAY;

function supabaseConfigured(): boolean {
  return !!(
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY) &&
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)
  );
}

export type Alert = {
  tone: "critical" | "warn";
  title: string;
  detail: string;
  href?: string;
};

export type Breakdown = { label: string; count: number };

export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;

/**
 * PageSpeed takes 10-30s per URL, so it is cached hard and separately. The dashboard
 * renders whatever the last run produced; a cold cache shows a pending state rather than
 * making anyone wait.
 */
const cachedPageSpeed = unstable_cache(
  async (origin: string) => loadPageSpeed(origin),
  // The measured paths are part of the key, so editing PAGESPEED_TARGETS busts the cache
  // instead of serving yesterday's scores under today's labels for up to 24 hours.
  ["pagespeed", PAGESPEED_TARGETS.map((t) => t.path).join(",")],
  { revalidate: 86_400, tags: ["pagespeed"] }
);

type LeadRow = {
  created_at: string;
  tier: string | null;
  inquiry_type: string | null;
  asset_count: string | null;
  source_page: string | null;
  emailed: boolean | null;
  salesforce_synced: boolean | null;
};

function tally(rows: LeadRow[], pick: (r: LeadRow) => string | null, order?: readonly string[]): Breakdown[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = pick(r);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out = [...counts.entries()].map(([label, count]) => ({ label, count }));
  return order
    ? out.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
    : out.sort((a, b) => b.count - a.count);
}

export async function loadDashboard(origin: string) {
  const now = Date.now();

  if (!supabaseConfigured()) {
    return empty("Supabase isn't configured in this environment.", now);
  }

  try {
    const db = createAdminClient();
    const since90 = new Date(now - 90 * DAY).toISOString();

    const [leadsRes, staffRes, sourcesRes, usage, speed] = await Promise.all([
      db
        .from("leads")
        .select("created_at, tier, inquiry_type, asset_count, source_page, emailed, salesforce_synced")
        .gte("created_at", since90)
        .order("created_at", { ascending: false }),
      db.from("profiles").select("email, full_name, role, is_active, last_seen_at, created_at"),
      db.from("tender_sources").select("label, consecutive_empty, consecutive_failures, is_enabled"),
      loadToolUsage(),
      cachedPageSpeed(origin).catch(() => [] as PageSpeedScore[]),
    ]);

    const leads = (leadsRes.data ?? []) as LeadRow[];
    const staff = staffRes.data ?? [];

    const inWindow = (from: number, to: number) =>
      leads.filter((l) => {
        const t = new Date(l.created_at).getTime();
        return t >= from && t < to;
      });

    const thisWeek = inWindow(now - WEEK, now + DAY);
    const lastWeek = inWindow(now - 2 * WEEK, now - WEEK);

    // ── Attention strip ────────────────────────────────────────────────
    // Only failures that a human can act on. Empty on a good day.
    const alerts: Alert[] = [];

    const notEmailed = leads.filter((l) => l.emailed === false).length;
    if (notEmailed > 0) {
      alerts.push({
        tone: "critical",
        title: `${notEmailed} ${notEmailed === 1 ? "enquiry" : "enquiries"} nobody was notified about`,
        detail:
          "The quote form saved these but the notification email never sent. Usually a missing or wrong RESEND_API_KEY.",
      });
    }

    const latest = leads[0]?.created_at;
    const daysQuiet = latest ? Math.floor((now - new Date(latest).getTime()) / DAY) : null;
    if (daysQuiet !== null && daysQuiet >= 14) {
      alerts.push({
        tone: "warn",
        title: `No enquiries for ${daysQuiet} days`,
        detail: "Worth submitting the quote form yourself — a broken form looks exactly like a quiet fortnight.",
        href: "/quote",
      });
    }

    const neverSignedIn = staff.filter((s) => s.is_active && !s.last_seen_at).length;
    if (neverSignedIn > 0) {
      alerts.push({
        tone: "warn",
        title: `${neverSignedIn} staff ${neverSignedIn === 1 ? "account has" : "accounts have"} never been used`,
        detail: "Invited but never signed in. Their invite link may have expired.",
        href: "/admin/staff",
      });
    }

    for (const s of sourcesRes.data ?? []) {
      if (!s.is_enabled) continue;
      const empty = (s.consecutive_empty as number) ?? 0;
      const failed = (s.consecutive_failures as number) ?? 0;
      if (failed > 0 || empty >= 3) {
        alerts.push({
          tone: failed > 0 ? "critical" : "warn",
          title: `Tender source "${s.label}" ${failed > 0 ? "is failing" : "has gone quiet"}`,
          detail:
            failed > 0
              ? `${failed} failed run(s) in a row.`
              : `${empty} runs with nothing returned. They may have dropped us from their alert list.`,
          href: "/staff/accounts/tools/tender-watch",
        });
      }
    }

    // ── 12-week trend, oldest first ────────────────────────────────────
    const trend: { weekStart: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const from = now - (i + 1) * WEEK;
      trend.push({
        weekStart: new Date(from).toISOString().slice(0, 10),
        count: inWindow(from, now - i * WEEK).length,
      });
    }

    return {
      now,
      unavailable: null as string | null,
      alerts,
      enquiries: {
        thisWeek: thisWeek.length,
        lastWeek: lastWeek.length,
        tier1ThisWeek: thisWeek.filter((l) => l.tier === "tier1").length,
        last30: inWindow(now - 30 * DAY, now + DAY).length,
        total90: leads.length,
        daysSinceLast: daysQuiet,
        trend,
        byType: tally(leads, (l) => l.inquiry_type, INQUIRY_TYPES),
        byTier: tally(leads, (l) => l.tier),
        bySize: tally(leads, (l) => l.asset_count, ASSET_COUNT_RANGES),
        bySource: tally(leads, (l) => l.source_page).slice(0, 6),
      },
      staff: {
        active: staff.filter((s) => s.is_active).length,
        activeThisWeek: staff.filter(
          (s) => s.last_seen_at && new Date(s.last_seen_at).getTime() >= now - WEEK
        ).length,
        neverSignedIn,
        rows: staff
          .filter((s) => s.is_active)
          .map((s) => ({
            name: (s.full_name as string | null) ?? (s.email as string),
            role: s.role as string,
            lastSeenAt: (s.last_seen_at as string | null) ?? null,
          }))
          .sort((a, b) => (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "")),
      },
      tools: {
        usedThisWeek: [...usage.values()].reduce((n, s) => n + s.last7Days, 0),
        usedLast30: [...usage.values()].reduce((n, s) => n + s.last30Days, 0),
        byTool: usage,
      },
      pageSpeed: speed,
    };
  } catch (e) {
    const message = (e as Error).message;
    console.error("[admin] dashboard load failed:", message);
    return empty(`Couldn't load dashboard data: ${message}`, now);
  }
}

function empty(unavailable: string, now: number) {
  return {
    now,
    unavailable,
    alerts: [] as Alert[],
    enquiries: {
      thisWeek: 0,
      lastWeek: 0,
      tier1ThisWeek: 0,
      last30: 0,
      total90: 0,
      daysSinceLast: null as number | null,
      trend: [] as { weekStart: string; count: number }[],
      byType: [] as Breakdown[],
      byTier: [] as Breakdown[],
      bySize: [] as Breakdown[],
      bySource: [] as Breakdown[],
    },
    staff: {
      active: 0,
      activeThisWeek: 0,
      neverSignedIn: 0,
      rows: [] as { name: string; role: string; lastSeenAt: string | null }[],
    },
    tools: {
      usedThisWeek: 0,
      usedLast30: 0,
      byTool: new Map<string, { toolSlug: string; last30Days: number; last7Days: number; lastUsedAt: string | null }>(),
    },
    pageSpeed: [] as PageSpeedScore[],
  };
}
