import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBearerSecret } from "@/lib/auth/shared-secret";
import { isApiAdmin } from "@/lib/auth/is-staff";
import { safeText } from "@/lib/html";
import { STALLED_RUN_MS } from "@/lib/tenders/config";

/**
 * The morning invariant check — 9am Brisbane, before anyone opens the inbox.
 *
 * A dashboard nobody opens is not observability. This is the part that comes and finds
 * you: it emails only when something is actually broken, PLUS a weekly all-clear on
 * Mondays so that silence is itself testable. An alerting system that only ever sends
 * failures is indistinguishable from one that has stopped working.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

type Check = { level: "critical" | "warning"; title: string; detail: string };

export async function GET(req: NextRequest) {
  const gate = requireBearerSecret(req, "CRON_SECRET");
  if (!gate.ok) {
    if (gate.status === 503) {
      return NextResponse.json({ ok: false, error: gate.reason }, { status: 503 });
    }
    if (!(await isApiAdmin())) {
      return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
    }
  }

  const db = createAdminClient();
  const checks: Check[] = [];

  try {
    const [lastRun, sources, unforwarded, pending, stalled] = await Promise.all([
      db.from("tender_scan_runs").select("started_at, status").eq("status", "succeeded").order("started_at", { ascending: false }).limit(1),
      db.from("tender_sources").select("slug, label, is_enabled, consecutive_empty, consecutive_failures, last_error, alert_on_quiet"),
      db.from("tender_items").select("id", { count: "exact", head: true }).in("relevance", ["match", "maybe"]).is("forwarded_at", null),
      db.from("tender_items").select("id", { count: "exact", head: true }).eq("relevance", "pending"),
      db
        .from("tender_scan_runs")
        .select("id", { count: "exact", head: true })
        .eq("status", "running")
        .lt("started_at", new Date(Date.now() - STALLED_RUN_MS).toISOString()),
    ]);

    // 1. Has the cron stopped firing? The single most important check here.
    const lastAt = lastRun.data?.[0]?.started_at as string | undefined;
    const hours = lastAt ? (Date.now() - new Date(lastAt).getTime()) / 3_600_000 : Infinity;
    if (hours > 30) {
      checks.push({
        level: "critical",
        title: "No successful scan in over 30 hours",
        detail: lastAt ? `Last success was ${Math.floor(hours)} hours ago.` : "There has never been a successful scan.",
      });
    }

    // 2. Has a source gone quiet? No error count can catch this.
    for (const s of sources.data ?? []) {
      if (!s.is_enabled) continue;
      const empty = (s.consecutive_empty as number) ?? 0;
      const failures = (s.consecutive_failures as number) ?? 0;
      // Quiet is only a problem for sources somebody opted into watching. Sources are
      // discovered per sender domain now, so most of them are one-off client invitations
      // that are silent by nature — alerting on those would bury the portal that actually
      // stopped sending. A FAILING source is still reported whoever owns it.
      const watched = (s.alert_on_quiet as boolean) ?? false;

      if (failures >= 1) {
        checks.push({
          level: "critical",
          title: `${s.label} is failing`,
          detail: `${failures} failed run(s) in a row. ${(s.last_error as string) ?? ""}`.trim(),
        });
      } else if (watched && empty >= 5) {
        checks.push({
          level: "critical",
          title: `${s.label} has produced nothing for ${empty} runs`,
          detail: "Either they dropped us from their alert list, or their format changed and the parser is finding nothing.",
        });
      } else if (watched && empty >= 3) {
        checks.push({
          level: "warning",
          title: `${s.label} has been quiet for ${empty} runs`,
          detail: "Worth checking we are still registered for their alerts.",
        });
      }
    }

    // 3. Are matches reaching anyone?
    if ((unforwarded.count ?? 0) > 0) {
      checks.push({
        level: "warning",
        title: `${unforwarded.count} matched tender(s) not delivered`,
        detail: "Email delivery is failing or not configured. They will be re-sent on the next successful run.",
      });
    }

    // 4. Is the classifier keeping up?
    if ((pending.count ?? 0) > 100) {
      checks.push({
        level: "warning",
        title: `${pending.count} tenders awaiting classification`,
        detail: "The backlog is growing — check the daily budget cap and the Anthropic key.",
      });
    }

    if ((stalled.count ?? 0) > 0) {
      checks.push({
        level: "warning",
        title: `${stalled.count} scan run(s) stalled`,
        detail: "A run started and never finished — likely a function timeout.",
      });
    }

    // Monday = 1. The all-clear makes silence meaningful the rest of the week.
    const isMonday =
      new Date().toLocaleDateString("en-AU", { weekday: "short", timeZone: "Australia/Brisbane" }) === "Mon";

    const shouldEmail = checks.length > 0 || isMonday;
    let emailed = false;
    if (shouldEmail) emailed = await sendHealthEmail(checks, isMonday, hours);

    return NextResponse.json({ ok: true, checks, emailed });
  } catch (e) {
    const error = (e as Error).message;
    console.error("[tenders] health check failed:", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}

async function sendHealthEmail(checks: Check[], isAllClear: boolean, hoursSinceScan: number): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[tenders] health check found issues but RESEND_API_KEY is not set:", checks);
    return false;
  }

  const to = process.env.ADMIN_EMAIL ?? "info@ausdilaps.com.au";
  const from = process.env.RESEND_FROM_EMAIL ?? "AusDilaps <no-reply@ausdilaps.com.au>";
  const critical = checks.filter((c) => c.level === "critical").length;

  const subject = checks.length
    ? `Tender Watch — ${critical > 0 ? "action needed" : "check"}: ${checks.length} issue${checks.length === 1 ? "" : "s"}`
    : "Tender Watch — all clear";

  const body = checks.length
    ? checks
        .map(
          (c) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e3e5e7">
            <div style="font-size:13px;font-weight:600;color:${c.level === "critical" ? "#b8402c" : "#a8701a"}">${safeText(c.title, 160)}</div>
            <div style="font-size:12px;color:#5b6570;margin-top:2px">${safeText(c.detail, 400)}</div>
          </td></tr>`
        )
        .join("")
    : `<tr><td style="padding:10px 0;font-size:13px;color:#2f343a">
         Everything is running. Last successful scan was ${Math.floor(hoursSinceScan)} hours ago, all sources are producing,
         and nothing is stuck in the queue.
       </td></tr>`;

  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f3f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e5e7;border-radius:10px;overflow:hidden">
      <tr><td style="background:#23272b;padding:18px 22px">
        <div style="font-size:11px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:#6d90b4">Tender Watch &middot; morning check</div>
        <div style="font-size:17px;font-weight:600;color:#fff;margin-top:4px">${isAllClear && !checks.length ? "All clear" : `${checks.length} issue${checks.length === 1 ? "" : "s"}`}</div>
      </td></tr>
      <tr><td style="padding:8px 22px 18px"><table role="presentation" width="100%">${body}</table></td></tr>
    </table></body></html>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error("[tenders] health email failed:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("[tenders] health email failed:", e);
    return false;
  }
}
