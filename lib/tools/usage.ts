import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Tool usage recording and read-back.
 *
 * One row per tool action, so /admin/tools can show which tools actually get used. No
 * user id is stored — see the note at the top of 0008_tool_usage.sql.
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
export async function recordToolUse(toolSlug: string): Promise<void> {
  try {
    await createAdminClient().from("tool_usage").insert({ tool_slug: toolSlug });
  } catch (e) {
    console.error("[tool-usage] failed to record:", toolSlug, (e as Error).message);
  }
}

export type ToolUsageStat = {
  toolSlug: string;
  last30Days: number;
  last7Days: number;
  lastUsedAt: string | null;
};

/**
 * Usage per tool over the last 30 days.
 *
 * Aggregated in JS rather than SQL: at a few thousand rows a year this is far cheaper than
 * a round trip per tool, and it keeps the whole thing to one query. Revisit if the table
 * ever gets large enough for that to stop being true.
 */
export async function loadToolUsage(): Promise<Map<string, ToolUsageStat>> {
  const out = new Map<string, ToolUsageStat>();
  try {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const sevenDaysAgo = Date.now() - 7 * 86_400_000;

    const { data, error } = await createAdminClient()
      .from("tool_usage")
      .select("tool_slug, used_at")
      .gte("used_at", since);

    if (error || !data) return out;

    for (const row of data) {
      const slug = row.tool_slug as string;
      const usedAt = row.used_at as string;
      const stat = out.get(slug) ?? { toolSlug: slug, last30Days: 0, last7Days: 0, lastUsedAt: null };
      stat.last30Days++;
      if (new Date(usedAt).getTime() >= sevenDaysAgo) stat.last7Days++;
      if (!stat.lastUsedAt || usedAt > stat.lastUsedAt) stat.lastUsedAt = usedAt;
      out.set(slug, stat);
    }
  } catch (e) {
    console.error("[tool-usage] failed to load:", (e as Error).message);
  }
  return out;
}
