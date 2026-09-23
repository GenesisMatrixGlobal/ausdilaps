"use client";

// Transcription Buddy, Daily runs tab — the log of the nightly crawl.
//
// One row per night, newest first: how many recordings were found, transcribed and failed, how
// many inspector folders had no recording, and whether the morning report went. Open a night to
// see every inspector's folder, their transcripts (For typing / Cleaned / Raw, with Copy — the
// same three views as the Manual tab) and anything that went wrong. Every figure is counted
// from the log rows by /api/transcription/nightly/log; nothing here is a stored counter.

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useCopied } from "@/components/tools/shared/copy-text";
import { formatBatch } from "@/lib/transcription/format";
import { addDays, displayDate, sydneyNow } from "@/lib/transcription/nightly/dates";

type RunSummary = {
  date: string;
  status: string;
  dayFolderId: string | null;
  dayFolderPath: string | null;
  lastTickAt: string | null;
  reportSentAt: string | null;
  reportEmailed: boolean;
  reportLive: boolean;
  reportError: string | null;
  error: string | null;
  folders: number;
  missing: number;
  recordings: number;
  transcribed: number;
  failed: number;
  pending: number;
  skipped: number;
  flags: number;
  minutes: number;
};

type FolderRow = { box_folder_id: string; folder_name: string; initials: string | null; match_kind: string; staff_name: string | null; staff_email: string | null; notes_files: string[] | null };
type FileRow = {
  box_file_id: string;
  box_folder_id: string;
  inspector_folder_id: string | null;
  name: string;
  size: number;
  status: string;
  attempts: number;
  error: string | null;
  typing: string | null;
  cleaned: string | null;
  raw: string | null;
  flags: number | null;
  duration_seconds: number | null;
  txt_box_file_id: string | null;
  txt_error: string | null;
};
type StoredReport = { notices?: { staffName: string; email: string; folders?: { name: string }[]; sent?: boolean; error?: string }[]; live?: boolean; unmatchedMissing?: string[]; sendError?: string | null; emailed?: boolean };
type Detail = { run: { report: StoredReport | null; error: string | null; day_folder_path: string | null } | null; folders: FolderRow[]; files: FileRow[] };

type View = "typing" | "cleaned" | "raw";
const VIEWS: { key: View; label: string }[] = [
  { key: "typing", label: "For typing" },
  { key: "cleaned", label: "Cleaned" },
  { key: "raw", label: "Raw" },
];

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  transcribing: "Transcribing",
  done: "Transcribed",
  failed: "Failed",
  skipped: "Over the nightly limit",
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string } & T) | null;
  if (!json) throw new Error(res.status === 504 ? "The server gave up waiting — the run carries on at the next tick." : `Unexpected response (HTTP ${res.status}).`);
  if (!json.ok) throw new Error(json.error ?? "Request failed.");
  return json;
}

const boxFolder = (id: string) => `https://ausdilaps.app.box.com/folder/${id}`;
const boxFile = (id: string) => `https://ausdilaps.app.box.com/file/${id}`;
const mins = (s: number | null) => (s ? `${Math.max(1, Math.round(s / 60))} min` : "");

function summary(r: RunSummary): string {
  if (!r.dayFolderId) return r.dayFolderPath ? `No day folder — ${r.dayFolderPath}` : "No day folder found";
  const parts = [`${r.recordings} recording${r.recordings === 1 ? "" : "s"}`, `${r.transcribed} transcribed`];
  if (r.pending) parts.push(`${r.pending} in progress`);
  if (r.skipped) parts.push(`${r.skipped} over the limit`);
  return parts.join(" · ");
}

function reportLine(r: RunSummary): { text: string; warn: boolean } {
  if (r.reportError) return { text: `Report not sent: ${r.reportError}`, warn: true };
  if (r.reportSentAt) {
    const at = new Date(r.reportSentAt).toLocaleTimeString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" });
    return { text: r.reportEmailed ? `Report sent ${at}${r.reportLive ? "" : " · inspector emails off"}` : `Nothing to report (${at})`, warn: false };
  }
  return { text: "Report not sent yet", warn: false };
}

export function DailyRuns({ isAdmin }: { isAdmin: boolean }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [view, setView] = useState<View>("typing");

  const load = useCallback(async () => {
    try {
      const json = await post<{ runs: RunSummary[] }>("/api/transcription/nightly/log", {});
      setRuns(json.runs);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const loadDetail = useCallback(async (date: string) => {
    try {
      const json = await post<Detail>("/api/transcription/nightly/log", { date });
      setDetails((d) => ({ ...d, [date]: { run: json.run, folders: json.folders, files: json.files } }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // Fetched on first open of the tab (the shell mounts this pane lazily), then on demand.
    let live = true;
    void post<{ runs: RunSummary[] }>("/api/transcription/nightly/log", {})
      .then((j) => live && setRuns(j.runs))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  const toggle = (date: string) => {
    const next = open === date ? null : date;
    setOpen(next);
    if (next) void loadDetail(next);
  };

  return (
    <div>
      {isAdmin && <RunPanel onDone={async (date) => { await load(); if (open === date) await loadDetail(date); }} />}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p className="text-sm text-ad-muted">
          Every morning from 4am (Sydney) yesterday&apos;s folder in Box Inspector Uploads is transcribed, a .txt is saved beside each recording, and the report team is emailed a summary.
        </p>
        <button type="button" className={cn(buttonVariants({ variant: "outline", size: "sm" }))} onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-ad-orange">{error}</p>}
      {runs && runs.length === 0 && <p className="mt-4 text-sm text-ad-muted">No nightly runs yet.</p>}
      {!runs && !error && <p className="mt-4 text-sm text-ad-muted">Loading…</p>}

      {runs && runs.length > 0 && (
        <ul className="mt-4 divide-y divide-ad-border rounded-xl border border-ad-border text-sm">
          {runs.map((r) => {
            const rep = reportLine(r);
            return (
              <li key={r.date}>
                <button type="button" onClick={() => toggle(r.date)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-ad-surface" aria-expanded={open === r.date}>
                  <span className="w-32 font-medium text-ad-ink">{displayDate(r.date)}</span>
                  <span className="flex-1 text-ad-ink">
                    {summary(r)}
                    {r.failed > 0 && <span className="text-ad-orange">{` · ${r.failed} failed`}</span>}
                    {r.missing > 0 && <span className="text-ad-orange">{` · ${r.missing} folder${r.missing === 1 ? "" : "s"} with no recording`}</span>}
                    {r.flags > 0 && <span className="text-ad-muted">{` · ${r.flags} [CHECK]`}</span>}
                  </span>
                  <span className={rep.warn ? "text-ad-orange" : "text-ad-muted"}>{rep.text}</span>
                  <span className="text-ad-muted">{open === r.date ? "−" : "+"}</span>
                </button>
                {r.error && <p className="px-4 pb-2 text-ad-orange">{r.error}</p>}
                {open === r.date && (
                  <div className="border-t border-ad-border bg-ad-surface/40 px-4 py-4">
                    {details[r.date] ? <NightDetail run={r} detail={details[r.date]} view={view} setView={setView} /> : <p className="text-ad-muted">Loading…</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NightDetail({ run, detail, view, setView }: { run: RunSummary; detail: Detail; view: View; setView: (v: View) => void }) {
  const report = detail.run?.report ?? null;
  const groups = [
    ...detail.folders.map((f) => ({ key: f.box_folder_id, folder: f as FolderRow | null, files: detail.files.filter((x) => x.inspector_folder_id === f.box_folder_id) })),
    ...(detail.files.some((x) => !x.inspector_folder_id) ? [{ key: "loose", folder: null, files: detail.files.filter((x) => !x.inspector_folder_id) }] : []),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-full border border-ad-border bg-white text-sm" role="tablist" aria-label="Transcript view">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)} className={cn("h-9 px-4 font-medium", view === v.key ? "bg-ad-navy text-white" : "text-ad-ink hover:bg-ad-surface")}>
              {v.label}
            </button>
          ))}
        </div>
        {run.dayFolderId && (
          <a href={boxFolder(run.dayFolderId)} target="_blank" rel="noreferrer" className="text-sm text-ad-steel underline">
            {run.dayFolderPath ?? "Box folder"}
          </a>
        )}
      </div>

      {report?.notices && report.notices.length > 0 && (
        <p className="mt-3 text-sm text-ad-muted">
          {report.live ? "Emailed about a missing recording: " : "Would have emailed about a missing recording (inspector emails are off): "}
          {report.notices.map((n) => `${n.staffName} (${n.email}, ${n.folders?.length ?? 1} job${(n.folders?.length ?? 1) === 1 ? "" : "s"})${n.error ? ` — failed: ${n.error}` : ""}`).join(", ")}
        </p>
      )}
      {report?.unmatchedMissing && report.unmatchedMissing.length > 0 && (
        <p className="mt-1 text-sm text-ad-orange">Not emailed — initials don&apos;t match one current inspector: {report.unmatchedMissing.join(", ")}</p>
      )}

      {groups.length === 0 && <p className="mt-3 text-sm text-ad-muted">No job folders in this day folder.</p>}
      <div className="mt-3 space-y-3">
        {groups.map((g) => (
          <InspectorGroup key={g.key} folder={g.folder} files={g.files} view={view} />
        ))}
      </div>
    </div>
  );
}

function InspectorGroup({ folder, files, view }: { folder: FolderRow | null; files: FileRow[]; view: View }) {
  const { copied, failed, copy } = useCopied();
  const done = files.filter((f) => f.status === "done");
  const text = formatBatch(done.map((f) => (view === "raw" ? f.raw : view === "cleaned" ? f.cleaned : f.typing) ?? ""));
  const title = folder
    ? folder.match_kind === "match" && folder.staff_name
      ? `${folder.folder_name} · ${folder.staff_name}`
      : folder.match_kind === "ambiguous"
        ? `${folder.folder_name} · initials match more than one inspector`
        : `${folder.folder_name} · not a current inspector's initials`
    : "Not in a job folder";

  return (
    <details className="rounded-xl border border-ad-border bg-white" open={files.length === 0 || undefined}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
        <span className="font-medium text-ad-ink">{title}</span>
        {files.length === 0 ? (
          <span className="text-ad-orange">
            No recording{folder?.notes_files?.length ? <span className="text-ad-muted"> · written notes: {folder.notes_files.join(", ")}</span> : null}
          </span>
        ) : (
          <span className="text-ad-muted">
            {done.length} of {files.length} transcribed
          </span>
        )}
        {folder && (
          <a href={boxFolder(folder.box_folder_id)} target="_blank" rel="noreferrer" className="text-ad-steel underline" onClick={(e) => e.stopPropagation()}>
            Box
          </a>
        )}
      </summary>
      {files.length > 0 && (
        <div className="border-t border-ad-border px-4 py-3">
          <ul className="space-y-1 text-sm">
            {files.map((f) => (
              <li key={f.box_file_id} className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                <a href={boxFile(f.box_file_id)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-ad-ink hover:underline" title={f.name}>
                  {f.name}
                </a>
                <span className="text-ad-muted">{mins(f.duration_seconds)}</span>
                {!!f.flags && <span className="text-ad-orange">{f.flags} [CHECK]</span>}
                <span className={f.status === "failed" ? "text-ad-orange" : f.status === "done" ? "text-ad-steel" : "text-ad-muted"}>{STATUS_LABEL[f.status] ?? f.status}</span>
                {f.txt_box_file_id && (
                  <a href={boxFile(f.txt_box_file_id)} target="_blank" rel="noreferrer" className="text-ad-steel underline">
                    .txt
                  </a>
                )}
                {f.error && f.status !== "done" && <span className="basis-full text-ad-orange">{f.error}</span>}
                {f.txt_error && <span className="basis-full text-ad-orange">.txt not saved to Box: {f.txt_error}</span>}
              </li>
            ))}
          </ul>
          {done.length > 0 && (
            <>
              <button type="button" className={cn(buttonVariants({ variant: "primary", size: "sm" }), "mt-3")} onClick={() => void copy(text)}>
                {copied ? "Copied" : failed ? "Copy failed" : done.length > 1 ? "Copy all" : "Copy"}
              </button>
              <textarea readOnly value={text} className="mt-2 h-[40vh] w-full resize-y rounded-lg border border-ad-border bg-white p-3 font-mono text-sm leading-relaxed text-ad-ink focus:outline-none focus:ring-2 focus:ring-ad-accent" />
            </>
          )}
        </div>
      )}
    </details>
  );
}

/** Admins only: run (or re-run) any past night now. It never emails the team or an inspector —
 *  "Email me the report" sends a copy to the signed-in admin and nobody else. */
function RunPanel({ onDone }: { onDone: (date: string) => Promise<void> }) {
  const [date, setDate] = useState(() => addDays(sydneyNow(new Date()).date, -1));
  const [retryFailed, setRetryFailed] = useState(false);
  const [emailMe, setEmailMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; warn: boolean } | null>(null);

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await post<{ ran: boolean; note: string; transcribed: number; failed: number }>("/api/transcription/nightly", { date, retryFailed, emailMe });
      setNote({ text: r.ran ? `${r.note} ${r.transcribed} transcribed${r.failed ? `, ${r.failed} failed` : ""} this run. Run again to carry on if files are still queued.` : r.note, warn: false });
      await onDone(date);
    } catch (e) {
      setNote({ text: (e as Error).message, warn: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-ad-border bg-white p-3 text-sm">
      <span className="font-medium text-ad-ink">Run a night now</span>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-lg border border-ad-border px-2 text-ad-ink" />
      <label className="flex items-center gap-1.5 text-ad-ink">
        <input type="checkbox" checked={retryFailed} onChange={(e) => setRetryFailed(e.target.checked)} /> Retry failed
      </label>
      <label className="flex items-center gap-1.5 text-ad-ink">
        <input type="checkbox" checked={emailMe} onChange={(e) => setEmailMe(e.target.checked)} /> Email me the report
      </label>
      <button type="button" className={cn(buttonVariants({ variant: "primary", size: "sm" }))} disabled={busy || !date} onClick={() => void run()}>
        {busy ? "Running…" : "Run now"}
      </button>
      {note && <span className={cn("basis-full", note.warn ? "text-ad-orange" : "text-ad-muted")}>{note.text}</span>}
    </div>
  );
}
