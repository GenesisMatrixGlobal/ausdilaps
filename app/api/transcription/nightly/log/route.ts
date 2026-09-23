import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaffInAnyDepartment } from "@/lib/auth/is-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { TRANSCRIPTION_ALLOW_UNAUTHED_ENV, TRANSCRIPTION_DEPARTMENTS } from "@/lib/transcription/config";
import { addDays, isIsoDate, sydneyNow } from "@/lib/transcription/nightly/dates";
import { selectFolders } from "@/lib/transcription/nightly/run";

// Read side of the Daily runs tab. No date → the last few weeks of nights with their figures;
// a date → that night in full, transcripts included. Every figure is COUNTED from the rows here
// (migration 0025 keeps no counters). Staff-gated like the tool itself; the tables have RLS on
// and no policies, so this route and the cron are the only readers.

export const runtime = "nodejs";

const LIST_DAYS = 45;

const bodySchema = z.object({ date: z.string().refine(isIsoDate).optional() });

export async function POST(req: NextRequest) {
  if (!(await isStaffInAnyDepartment(TRANSCRIPTION_DEPARTMENTS, TRANSCRIPTION_ALLOW_UNAUTHED_ENV))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid input." }, { status: 400 });
  const db = createAdminClient();

  if (parsed.data.date) {
    const date = parsed.data.date;
    const [run, folders, files] = await Promise.all([
      db.from("transcription_nightly_runs").select("*").eq("run_date", date).maybeSingle(),
      selectFolders(date),
      db
        .from("transcription_nightly_files")
        .select("box_file_id, box_folder_id, inspector_folder_id, name, size, status, attempts, error, typing, cleaned, raw, flags, duration_seconds, txt_box_file_id, txt_error, updated_at")
        .eq("run_date", date)
        .order("name"),
    ]);
    const err = run.error ?? folders.error ?? files.error;
    if (err) return NextResponse.json({ ok: false, error: missingTable(err.message) }, { status: 500 });
    return NextResponse.json({ ok: true, run: run.data, folders: folders.data ?? [], files: files.data ?? [] });
  }

  const since = addDays(sydneyNow(new Date()).date, -LIST_DAYS);
  const [runs, folders, files] = await Promise.all([
    db.from("transcription_nightly_runs").select("run_date, status, day_folder_id, day_folder_path, last_tick_at, report_sent_at, report, error").gte("run_date", since).order("run_date", { ascending: false }),
    db.from("transcription_nightly_folders").select("run_date, box_folder_id").gte("run_date", since),
    pageAll(since),
  ]);
  const err = runs.error ?? folders.error;
  if (err) return NextResponse.json({ ok: false, error: missingTable(err.message) }, { status: 500 });

  const out = (runs.data ?? []).map((r) => {
    const fs = files.filter((f) => f.run_date === r.run_date);
    const withAudio = new Set(fs.map((f) => f.inspector_folder_id));
    const fl = (folders.data ?? []).filter((f) => f.run_date === r.run_date);
    const report = r.report as { live?: boolean; emailed?: boolean; sendError?: string | null } | null;
    return {
      date: r.run_date,
      status: r.status,
      dayFolderId: r.day_folder_id,
      dayFolderPath: r.day_folder_path,
      lastTickAt: r.last_tick_at,
      reportSentAt: r.report_sent_at,
      reportEmailed: report?.emailed ?? false,
      reportLive: report?.live ?? false,
      reportError: report?.sendError ?? null,
      error: r.error,
      folders: fl.length,
      missing: fl.filter((f) => !withAudio.has(f.box_folder_id)).length,
      recordings: fs.length,
      transcribed: fs.filter((f) => f.status === "done").length,
      failed: fs.filter((f) => f.status === "failed").length,
      pending: fs.filter((f) => f.status === "queued" || f.status === "transcribing").length,
      skipped: fs.filter((f) => f.status === "skipped").length,
      flags: fs.reduce((n, f) => n + (f.flags ?? 0), 0),
      minutes: Math.round(fs.reduce((n, f) => n + Number(f.duration_seconds ?? 0), 0) / 60),
    };
  });
  return NextResponse.json({ ok: true, runs: out });
}

type Slim = { run_date: string; inspector_folder_id: string | null; status: string; flags: number | null; duration_seconds: number | null };

/** PostgREST stops at 1,000 rows; a busy six weeks passes that. */
async function pageAll(since: string): Promise<Slim[]> {
  const db = createAdminClient();
  const out: Slim[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("transcription_nightly_files")
      .select("run_date, inspector_folder_id, status, flags, duration_seconds")
      .gte("run_date", since)
      .order("id")
      .range(from, from + 999);
    if (error || !data) break;
    out.push(...(data as Slim[]));
    if (data.length < 1000) break;
  }
  return out;
}

function missingTable(message: string): string {
  return /does not exist|schema cache/i.test(message) ? "The Daily runs log isn't set up yet — apply migration 0025 in Supabase." : message;
}
