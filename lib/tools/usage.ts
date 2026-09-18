import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isProductionRuntime } from "@/lib/page-views";
import { GAME_SLUGS } from "@/lib/tools/registry";

/**
 * Tool usage recording and read-back.
 *
 * One row per tool action, so /admin/tools can show which tools actually get used and
 * /admin/staff can show who is using them. The user id arrived with migration 0020 — 0008
 * deliberately left it off, and the note at the top of 0020 says why that changed.
 */

/**
 * Records one use. NEVER throws and never blocks the caller.
 *
 * Counted at the auth gate, which runs BEFORE request validation — so a malformed request
 * counts as an attempt. That is deliberate: for "does anyone use this tool", an attempt is
 * the signal, and moving the count to each route's success path would mean touching every
 * route and losing the single choke point.
 *
 * Deliberately not awaited by callers: a tool must not fail, or even slow down, because
 * an analytics insert had a bad day. Errors are logged and swallowed.
 *
 * Note this runs on a Vercel function that may be frozen the moment the response is sent,
 * so a genuinely fire-and-forget promise can be killed mid-flight. Callers therefore hand
 * this to `after()` from next/server, which keeps the function alive until it settles.
 */
export async function recordToolUse(toolSlug: string, userId?: string | null): Promise<void> {
  // A tool opened on localhost is us testing it, not a staff member using it.
  if (!isProductionRuntime()) return;
  try {
    const db = createAdminClient();
    const row: { tool_slug: string; user_id?: string } = { tool_slug: toolSlug };
    if (userId) row.user_id = userId;

    // ⚠️ Supabase RETURNS errors rather than throwing — an unchecked insert here would
    // record nothing and say nothing.
    let { error } = await db.from("tool_usage").insert(row);

    // user_id arrives with migration 0020. Migrations are pasted by hand on this project, so
    // a deploy can land before its column does — and a failed insert here would silently
    // stop EVERY tool use being counted for that window. Fall back to the 0008 shape.
    if (error && row.user_id && /user_id/.test(error.message)) {
      console.warn("[tool-usage] tool_usage.user_id missing — apply migration 0020.");
      ({ error } = await db.from("tool_usage").insert({ tool_slug: toolSlug }));
    }
    if (error) throw error;
  } catch (e) {
    console.error("[tool-usage] failed to record:", toolSlug, (e as Error).message);
  }
}

const WINDOW_DAYS = 30;
const DAY = 86_400_000;

type UsageRow = { tool_slug: string; used_at: string; user_id: string | null };

/**
 * Every row in the 30-day window, fetched ONCE per request.
 *
 * Both readers below derive from this. React's cache() scopes it to one request, so
 * /admin/tools — which needs the per-tool AND per-person views — pays for one query, not
 * two, and the two figures can never disagree because they were counted from different
 * snapshots.
 *
 * Aggregated in JS rather than SQL: at a few thousand rows a year this is far cheaper than
 * a round trip per tool, and it keeps the whole thing to one query. Revisit if the table
 * ever gets large enough for that to stop being true.
 */
const fetchUsageRows = cache(async (): Promise<UsageRow[]> => {
  const since = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString();
  const db = createAdminClient();

  const withUser = await db
    .from("tool_usage")
    .select("tool_slug, used_at, user_id")
    .gte("used_at", since);

  // Same pre-0020 fallback as the writer: report per tool exactly as before, with nobody
  // attributed, rather than an empty page.
  if (withUser.error && /user_id/.test(withUser.error.message)) {
    console.warn("[tool-usage] tool_usage.user_id missing — apply migration 0020.");
    const plain = await db.from("tool_usage").select("tool_slug, used_at").gte("used_at", since);
    if (plain.error) throw plain.error;
    return (plain.data ?? []).map((r) => ({ ...(r as Omit<UsageRow, "user_id">), user_id: null }));
  }
  if (withUser.error) throw withUser.error;
  return (withUser.data ?? []) as UsageRow[];
});

export type ToolUsageStat = {
  toolSlug: string;
  last30Days: number;
  last7Days: number;
  lastUsedAt: string | null;
  /** Uses per person in the window, most active first. Rows written before 0020 (or from a
   *  local dev bypass) carry no user and are counted in `unattributed` instead. */
  byUser: { userId: string; count: number }[];
  unattributed: number;
};

/** Usage per tool over the last 30 days. Never throws; an unreadable table is an empty map. */
export async function loadToolUsage(): Promise<Map<string, ToolUsageStat>> {
  const out = new Map<string, ToolUsageStat>();
  try {
    const sevenDaysAgo = Date.now() - 7 * DAY;
    const users = new Map<string, Map<string, number>>();

    for (const row of await fetchUsageRows()) {
      const stat = out.get(row.tool_slug) ?? {
        toolSlug: row.tool_slug,
        last30Days: 0,
        last7Days: 0,
        lastUsedAt: null,
        byUser: [],
        unattributed: 0,
      };
      stat.last30Days++;
      if (new Date(row.used_at).getTime() >= sevenDaysAgo) stat.last7Days++;
      if (!stat.lastUsedAt || row.used_at > stat.lastUsedAt) stat.lastUsedAt = row.used_at;
      if (row.user_id) {
        const perUser = users.get(row.tool_slug) ?? new Map<string, number>();
        perUser.set(row.user_id, (perUser.get(row.user_id) ?? 0) + 1);
        users.set(row.tool_slug, perUser);
      } else {
        stat.unattributed++;
      }
      out.set(row.tool_slug, stat);
    }

    for (const [slug, perUser] of users) {
      const stat = out.get(slug)!;
      stat.byUser = [...perUser]
        .map(([userId, count]) => ({ userId, count }))
        .sort((a, b) => b.count - a.count);
    }
  } catch (e) {
    console.error("[tool-usage] failed to load:", (e as Error).message);
  }
  return out;
}

export type StaffToolUsage = {
  userId: string;
  /**
   * Work tools only — GAMES ARE EXCLUDED, the same rule as the /admin headline. "Is this
   * person using the tools" is not answered by Site Snap plays, and a card reading "40 tool
   * uses" for someone who has never generated a markup would mislead exactly the reader
   * this figure is for.
   */
  last30Days: number;
  lastUsedAt: string | null;
  /** Work tools, most used first. */
  byTool: { toolSlug: string; count: number }[];
};

/** Usage per person over the last 30 days. Never throws; an unreadable table is an empty map. */
export async function loadToolUsageByUser(): Promise<Map<string, StaffToolUsage>> {
  const out = new Map<string, StaffToolUsage>();
  try {
    const tools = new Map<string, Map<string, number>>();

    for (const row of await fetchUsageRows()) {
      if (!row.user_id || GAME_SLUGS.has(row.tool_slug)) continue;
      const stat = out.get(row.user_id) ?? {
        userId: row.user_id,
        last30Days: 0,
        lastUsedAt: null,
        byTool: [],
      };
      stat.last30Days++;
      if (!stat.lastUsedAt || row.used_at > stat.lastUsedAt) stat.lastUsedAt = row.used_at;
      const perTool = tools.get(row.user_id) ?? new Map<string, number>();
      perTool.set(row.tool_slug, (perTool.get(row.tool_slug) ?? 0) + 1);
      tools.set(row.user_id, perTool);
      out.set(row.user_id, stat);
    }

    for (const [userId, perTool] of tools) {
      out.get(userId)!.byTool = [...perTool]
        .map(([toolSlug, count]) => ({ toolSlug, count }))
        .sort((a, b) => b.count - a.count);
    }
  } catch (e) {
    console.error("[tool-usage] failed to load by user:", (e as Error).message);
  }
  return out;
}
