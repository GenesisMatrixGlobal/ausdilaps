import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { soqlQuery } from "@/lib/salesforce";
import { getAccessToken, splitExtension, uploadFileAutoRenamed } from "@/lib/box";
import { withApiTool } from "@/lib/api-usage";
import { recordToolUse } from "@/lib/tools/usage";
import {
  NIGHTLY_CONCURRENCY,
  NIGHTLY_MAX_ATTEMPTS,
  NIGHTLY_MAX_MINUTES,
  NIGHTLY_REPORT_BY_SYDNEY,
  NIGHTLY_REPORT_EARLIEST_SYDNEY,
  NIGHTLY_START_HOUR_SYDNEY,
  NIGHTLY_UPLOADS_FOLDER_ID,
  TRANSCRIPTION_TOOL_SLUG,
} from "../config";
import { resolveBoxAudio } from "../box-source";
import { transcribeFromUrl } from "../run";
import { countFlags } from "../trim";
import { addDays, isAtOrAfter, sydneyNow, sydneyYesterday } from "./dates";
import { DayFolderError, discoverDay, type DayListing } from "./discover";
import { matchInspector, type StaffMember } from "./initials";
import { buildReport, renderDailyReport, renderMissingNotice, type FileRow, type FolderRow, type NightlyReport } from "./report";
import { addressList, sendEmail } from "./email";

// One TICK of the nightly crawl. The cron calls this every 10 minutes through the early
// morning; each tick picks up where the last left off, so nothing here has to finish in one
// function's lifetime:
//
//   1. lease     — one tick at a time per night (a lease that lapses, so a killed tick frees it)
//   2. discover  — list yesterday's day folder (free) and record every recording not yet seen
//   3. transcribe — feed queued recordings through transcribeFromUrl(), THE SAME pipeline the
//                   Manual tab uses, and file the For typing view as a .txt beside each one
//   4. report    — once, when the queue is empty (not before 5am) or at 6:30 regardless
//
// The transcription is deliberately not re-implemented here: this file only decides WHAT is fed
// in and keeps the log (migration 0025).

const RUNS = "transcription_nightly_runs";
const FOLDERS = "transcription_nightly_folders";
const FILES = "transcription_nightly_files";

/** A tick holds the night for at most this long; one killed at maxDuration frees it after. */
const LEASE_MS = 5 * 60_000;
/** Stop STARTING recordings after this much of the tick — one in flight must still finish
 *  inside the route's 290 s. A longer file that is cut off is retried by the next tick. */
const START_WINDOW_MS = 150_000;
/** A row left "transcribing" longer than this was on a tick that died; it goes back in line. */
const STUCK_MS = 8 * 60_000;

export type TickResult = {
  date: string;
  ran: boolean;
  note: string;
  transcribed: number;
  failed: number;
  reportSent: boolean;
  report?: NightlyReport;
};

type Trigger = "cron" | "manual";

export async function runNightlyTick(opts: {
  trigger: Trigger;
  now?: Date;
  /** Manual only — any past day. The cron always works on yesterday. */
  date?: string;
  /** Manual only — email the report to this one address (the signed-in admin), and nobody else. */
  reportTo?: string | null;
  /** Manual only — put failed and skipped recordings back in the queue first. */
  retryFailed?: boolean;
}): Promise<TickResult> {
  const now = opts.now ?? new Date();
  const date = opts.trigger === "manual" && opts.date ? opts.date : sydneyYesterday(now);
  const empty = { date, transcribed: 0, failed: 0, reportSent: false };

  if (opts.trigger === "cron" && sydneyNow(now).hour < NIGHTLY_START_HOUR_SYDNEY) {
    return { ...empty, ran: false, note: `Before ${NIGHTLY_START_HOUR_SYDNEY}am Sydney.` };
  }

  const db = createAdminClient();
  const ins = await db.from(RUNS).upsert({ run_date: date }, { onConflict: "run_date", ignoreDuplicates: true });
  if (ins.error) throw new Error(`Nightly log unavailable (apply migration 0025?): ${ins.error.message}`);

  const leaseAt = new Date().toISOString();
  const leased = await db
    .from(RUNS)
    .update({ lease_until: new Date(Date.now() + LEASE_MS).toISOString(), last_tick_at: leaseAt, status: "running" })
    .eq("run_date", date)
    .or(`lease_until.is.null,lease_until.lt.${leaseAt}`)
    .select("run_date")
    .maybeSingle();
  if (leased.error) throw new Error(leased.error.message);
  if (!leased.data) return { ...empty, ran: false, note: "Another run is working on this night." };

  const started = Date.now();
  let listing: DayListing | null = null;
  let runError: string | null = null;
  try {
    if (opts.retryFailed) {
      await db.from(FILES).update({ status: "queued", attempts: 0, error: null }).eq("run_date", date).in("status", ["failed", "skipped"]);
    }
    listing = await discover(date);
    const counts = await transcribeQueued(date, started);
    const reportSent = await maybeReport(date, now, listing, opts);
    const status = reportSent || (await reportAlreadySent(date)) ? "reported" : listing.dayFolder ? "waiting" : "no_folder";
    await db.from(RUNS).update({ status, lease_until: null, error: null }).eq("run_date", date);
    return {
      date,
      ran: true,
      note: listing.dayFolder ? `Day folder ${listing.dayFolder.path}.` : `No day folder yet (${listing.missingReason}).`,
      ...counts,
      reportSent,
    };
  } catch (e) {
    runError = (e as Error).message.replace(/https?:\/\/\S+/g, "[url]").slice(0, 500);
    console.error("[transcription-nightly]", date, runError);
    await db.from(RUNS).update({ status: "error", lease_until: null, error: runError }).eq("run_date", date);
    return { ...empty, ran: true, note: runError };
  }
}

// ── 2. discover ───────────────────────────────────────────────────────────────────────────

/** Current inspectors from Salesforce. A failure is not fatal: folders are still transcribed,
 *  they just come up as unknown and nobody is emailed. */
async function loadInspectors(): Promise<StaffMember[] | null> {
  try {
    const rows = await soqlQuery<{ Name: string; Work_Email__c: string | null }>(
      "SELECT Name, Work_Email__c FROM Staff__c WHERE Department__c = 'Inspector Team' AND Status__c IN ('Employed','Employed_Contractor')"
    );
    return rows.map((r) => ({ name: r.Name, email: r.Work_Email__c }));
  } catch (e) {
    console.error("[transcription-nightly] Staff__c read failed:", (e as Error).message);
    return null;
  }
}

async function discover(date: string): Promise<DayListing> {
  const db = createAdminClient();
  let listing: DayListing;
  try {
    listing = await discoverDay(NIGHTLY_UPLOADS_FOLDER_ID, date);
  } catch (e) {
    if (e instanceof DayFolderError) listing = { dayFolder: null, missingReason: e.message, folders: [], loose: [] };
    else throw e;
  }
  await db
    .from(RUNS)
    .update({ day_folder_id: listing.dayFolder?.id ?? null, day_folder_path: listing.dayFolder?.path ?? listing.missingReason ?? null })
    .eq("run_date", date);
  if (!listing.dayFolder) return listing;

  const staff = listing.folders.length ? await loadInspectors() : [];
  if (listing.folders.length) {
    const folderRows = listing.folders.map((f) => {
      const m = staff ? matchInspector(f.name, staff) : { kind: "unknown" as const, initials: f.name };
      return {
        run_date: date,
        box_folder_id: f.folderId,
        folder_name: f.name,
        initials: m.initials,
        match_kind: staff ? m.kind : "unknown",
        staff_name: m.kind === "match" ? m.name : null,
        staff_email: m.kind === "match" ? m.email : null,
        notes_files: f.notes,
      };
    });
    // Salesforce down → keep whatever an earlier tick resolved rather than blanking it.
    const write = (rows: Record<string, unknown>[]) =>
      staff
        ? db.from(FOLDERS).upsert(rows, { onConflict: "run_date,box_folder_id" })
        : db.from(FOLDERS).upsert(rows, { onConflict: "run_date,box_folder_id", ignoreDuplicates: true });
    let res = await write(folderRows);
    // notes_files joined 0025 after the first paste of it; a database without the column still
    // records the folders — just without the notes — rather than failing the whole night.
    if (res.error && /notes_files/.test(res.error.message)) {
      console.warn("[transcription-nightly] notes_files missing — re-run migration 0025.");
      res = await write(folderRows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "notes_files"))));
    }
    if (res.error) throw new Error(res.error.message);
  }

  const fileRows = [
    ...listing.folders.flatMap((f) => f.files.map((x) => ({ ...x, inspector: f.folderId as string | null }))),
    ...listing.loose.map((x) => ({ ...x, inspector: null as string | null })),
  ].map((x) => ({ run_date: date, box_file_id: x.fileId, box_folder_id: x.parentId, inspector_folder_id: x.inspector, name: x.name, size: x.size }));
  if (fileRows.length) {
    // ignoreDuplicates: a recording already known keeps its status — this is what makes each
    // one transcribed exactly once however many ticks see it.
    const res = await db.from(FILES).upsert(fileRows, { onConflict: "box_file_id", ignoreDuplicates: true });
    if (res.error) throw new Error(res.error.message);
  }
  return listing;
}

// ── 3. transcribe ─────────────────────────────────────────────────────────────────────────

type QueuedFile = { id: string; box_file_id: string; box_folder_id: string; name: string; attempts: number };

async function minutesDone(date: string): Promise<number> {
  const { data } = await createAdminClient().from(FILES).select("duration_seconds").eq("run_date", date).eq("status", "done");
  return (data ?? []).reduce((n, r) => n + Number(r.duration_seconds ?? 0), 0) / 60;
}

async function transcribeQueued(date: string, started: number): Promise<{ transcribed: number; failed: number }> {
  const db = createAdminClient();

  // A tick that died mid-file left its rows "transcribing"; the attempt already counted.
  const stuckBefore = new Date(Date.now() - STUCK_MS).toISOString();
  await db.from(FILES).update({ status: "queued" }).eq("run_date", date).eq("status", "transcribing").lt("updated_at", stuckBefore).lt("attempts", NIGHTLY_MAX_ATTEMPTS);
  await db
    .from(FILES)
    .update({ status: "failed", error: "Timed out on every attempt — try it from the Manual tab." })
    .eq("run_date", date)
    .eq("status", "transcribing")
    .lt("updated_at", stuckBefore)
    .gte("attempts", NIGHTLY_MAX_ATTEMPTS);

  const { data: queued, error } = await db
    .from(FILES)
    .select("id, box_file_id, box_folder_id, name, attempts")
    .eq("run_date", date)
    .eq("status", "queued")
    .order("created_at")
    .order("name");
  if (error) throw new Error(error.message);
  const line: QueuedFile[] = [...(queued ?? [])];
  let done = await minutesDone(date);
  let transcribed = 0;
  let failed = 0;
  let token: string | null = null;

  const worker = async () => {
    while (line.length && Date.now() - started < START_WINDOW_MS) {
      if (done >= NIGHTLY_MAX_MINUTES) {
        const rest = line.splice(0).map((f) => f.id);
        if (rest.length) await db.from(FILES).update({ status: "skipped", error: `Nightly limit of ${NIGHTLY_MAX_MINUTES} audio minutes reached.` }).in("id", rest);
        return;
      }
      const f = line.shift()!;
      const claimed = await db
        .from(FILES)
        .update({ status: "transcribing", attempts: f.attempts + 1, updated_at: new Date().toISOString() })
        .eq("id", f.id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();
      if (!claimed.data) continue;
      try {
        const p = await withApiTool(TRANSCRIPTION_TOOL_SLUG, async () => {
          const src = await resolveBoxAudio(f.box_file_id);
          return transcribeFromUrl(src.downloadUrl, src.name);
        });
        done += p.durationSeconds / 60;
        await db
          .from(FILES)
          .update({
            status: "done",
            error: null,
            typing: p.typing,
            cleaned: p.cleaned,
            raw: p.raw,
            flags: countFlags(p.typing),
            duration_seconds: p.durationSeconds,
            cost_cents: p.costCents,
            updated_at: new Date().toISOString(),
          })
          .eq("id", f.id);
        transcribed++;
        await recordToolUse(TRANSCRIPTION_TOOL_SLUG, null); // never throws

        // The For typing view, beside the recording. A failed upload is logged on the row and
        // never undoes the transcript — it is in the tool either way.
        try {
          token ??= await getAccessToken();
          const up = await uploadFileAutoRenamed({
            folderId: f.box_folder_id,
            filename: `${splitExtension(f.name).stem}.txt`,
            bytes: new TextEncoder().encode(p.typing),
            contentType: "text/plain; charset=utf-8",
            token,
          });
          await db.from(FILES).update({ txt_box_file_id: up.id, txt_error: null }).eq("id", f.id);
        } catch (e) {
          await db.from(FILES).update({ txt_error: (e as Error).message.slice(0, 300) }).eq("id", f.id);
        }
      } catch (e) {
        const message = (e as Error).message.replace(/https?:\/\/\S+/g, "[url]").slice(0, 300);
        const last = f.attempts + 1 >= NIGHTLY_MAX_ATTEMPTS;
        await db.from(FILES).update({ status: last ? "failed" : "queued", error: message, updated_at: new Date().toISOString() }).eq("id", f.id);
        if (last) failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: NIGHTLY_CONCURRENCY }, worker));
  return { transcribed, failed };
}

/** The folder rows for a night; without notes_files on a database from the first paste of 0025. */
export async function selectFolders(date: string) {
  const db = createAdminClient();
  const cols = "box_folder_id, folder_name, initials, match_kind, staff_name, staff_email";
  const res = await db.from(FOLDERS).select(`${cols}, notes_files`).eq("run_date", date).order("folder_name");
  if (res.error && /notes_files/.test(res.error.message)) return db.from(FOLDERS).select(cols).eq("run_date", date).order("folder_name");
  return res;
}

// ── 4. report ─────────────────────────────────────────────────────────────────────────────

async function reportAlreadySent(date: string): Promise<boolean> {
  const { data } = await createAdminClient().from(RUNS).select("report_sent_at").eq("run_date", date).maybeSingle();
  return !!data?.report_sent_at;
}

export async function loadReport(date: string, listing?: DayListing | null): Promise<NightlyReport> {
  const db = createAdminClient();
  const [run, folders, files] = await Promise.all([
    db.from(RUNS).select("day_folder_id, day_folder_path").eq("run_date", date).maybeSingle(),
    selectFolders(date),
    db.from(FILES).select("box_file_id, inspector_folder_id, name, status, attempts, error, flags, duration_seconds, txt_box_file_id, txt_error").eq("run_date", date),
  ]);
  const fileRows = (files.data ?? []) as FileRow[];
  return buildReport({
    date,
    dayFolderId: run.data?.day_folder_id ?? null,
    dayFolderPath: listing?.dayFolder?.path ?? (run.data?.day_folder_id ? run.data?.day_folder_path ?? null : null),
    missingReason: listing && !listing.dayFolder ? listing.missingReason ?? null : null,
    folders: (folders.data ?? []) as FolderRow[],
    files: fileRows,
    live: process.env.TRANSCRIPTION_NOTIFY_INSPECTORS === "true",
    budgetExhausted: fileRows.some((f) => f.status === "skipped"),
  });
}

function toolUrl(): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://ausdilaps.com.au").replace(/\/$/, "");
  return `${base}/staff/reports/tools/${TRANSCRIPTION_TOOL_SLUG}?tab=daily`;
}

async function maybeReport(date: string, now: Date, listing: DayListing, opts: { trigger: Trigger; reportTo?: string | null }): Promise<boolean> {
  const db = createAdminClient();

  // A manual run never sends the team report or an inspector email — at most a copy to the
  // admin who pressed the button, derived from their session by the route, never the body.
  if (opts.trigger === "manual") {
    if (!opts.reportTo) return false;
    const report = await loadReport(date, listing);
    const { subject, html } = renderDailyReport(report, toolUrl());
    await sendEmail({ to: [opts.reportTo], subject: `[TEST TO YOURSELF] ${subject}`, html, idempotencyKey: `transcription-report-test:${date}:${Date.now()}` });
    return false;
  }

  if (await reportAlreadySent(date)) return false;
  const next = addDays(date, 1);
  const pastDeadline = isAtOrAfter(now, next, NIGHTLY_REPORT_BY_SYDNEY.hour, NIGHTLY_REPORT_BY_SYDNEY.minute);
  const earliest = isAtOrAfter(now, next, NIGHTLY_REPORT_EARLIEST_SYDNEY.hour, NIGHTLY_REPORT_EARLIEST_SYDNEY.minute);
  const { count: pending } = await db.from(FILES).select("id", { count: "exact", head: true }).eq("run_date", date).in("status", ["queued", "transcribing"]);
  if (!pastDeadline && !(earliest && (pending ?? 0) === 0 && listing.dayFolder)) return false;

  const report = await loadReport(date, listing);
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() % 6 !== 0;
  // A quiet weekend is logged, not emailed. A WEEKDAY with nothing is emailed — a day folder that
  // cannot be found is exactly what someone needs to hear about.
  const worthSending = report.totals.recordings > 0 || report.inspectors.length > 0 || weekday;

  const recipients = addressList(process.env.TRANSCRIPTION_REPORT_EMAIL);
  let sendError: string | null = null;
  if (worthSending) {
    if (report.live) {
      for (const n of report.notices) {
        const msg = renderMissingNotice(n, date);
        const r = await sendEmail({ to: [n.email], cc: recipients, ...msg, idempotencyKey: `transcription-missing:${date}:${n.email.toLowerCase()}` });
        n.sent = r.sent;
        if (!r.sent) n.error = r.error;
      }
    }
    if (recipients.length === 0) sendError = "TRANSCRIPTION_REPORT_EMAIL is not set.";
    else {
      const { subject, html } = renderDailyReport(report, toolUrl());
      const r = await sendEmail({ to: recipients, subject, html, idempotencyKey: `transcription-report:${date}` });
      if (!r.sent) sendError = r.error ?? "Send failed.";
    }
  }
  // Stamped once sent (or once there was nothing worth sending). A FAILED send is stored with
  // its error but not stamped, so the next tick tries again — the idempotency keys stop the
  // inspector notices and a report Resend did accept from going twice.
  const settled = !worthSending || !sendError;
  await db
    .from(RUNS)
    .update({ report: { ...report, sendError, emailed: worthSending && !sendError }, ...(settled ? { report_sent_at: new Date().toISOString() } : {}) })
    .eq("run_date", date);
  return worthSending && !sendError;
}
