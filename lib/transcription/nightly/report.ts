// Pure: the morning report, built from the log rows, and both emails rendered from it. No env,
// no network — pinned by check:transcript.
//
// The report is stored on the run (transcription_nightly_runs.report) exactly as sent, so the
// Daily runs tab can always show what Brittany was told, even after the rows move on.

import { escapeHtml } from "@/lib/html";
import { displayDate } from "./dates";

export type FolderRow = {
  box_folder_id: string;
  folder_name: string;
  initials: string | null;
  match_kind: string;
  staff_name: string | null;
  staff_email: string | null;
  notes_files?: string[] | null;
};

export type FileRow = {
  box_file_id: string;
  inspector_folder_id: string | null;
  name: string;
  status: string;
  attempts: number;
  error: string | null;
  flags: number | null;
  duration_seconds: number | null;
  txt_box_file_id: string | null;
  txt_error: string | null;
};

export type ReportFile = { name: string; status: string; flags: number; minutes: number; error: string | null; txtError: string | null };

export type ReportInspector = {
  folderId: string;
  folderName: string;
  matchKind: string;
  staffName: string | null;
  staffEmail: string | null;
  files: ReportFile[];
  /** The folder is there and holds no recording. */
  missing: boolean;
  /** Written notes in a folder with no recording — see FoundFolder.notes. */
  notes: string[];
};

/** ONE email per inspector, listing every job folder of theirs with no recording. */
export type Notice = { staffName: string; email: string; folders: { id: string; name: string; notes: string[] }[]; sent?: boolean; error?: string };

export type NightlyReport = {
  date: string;
  dayFolderId: string | null;
  dayFolderPath: string | null;
  missingReason: string | null;
  inspectors: ReportInspector[];
  loose: ReportFile[];
  totals: { recordings: number; transcribed: number; failed: number; left: number; flags: number; minutes: number };
  budgetExhausted: boolean;
  /** Missing-recording emails: sent when live, only listed ("would have emailed") in shadow mode. */
  notices: Notice[];
  live: boolean;
  /** Missing folders that could not be tied to one inspector — reported, never emailed. */
  unmatchedMissing: string[];
};

export function boxFolderUrl(id: string): string {
  return `https://ausdilaps.app.box.com/folder/${id}`;
}

function toReportFile(f: FileRow): ReportFile {
  return {
    name: f.name,
    status: f.status,
    flags: f.flags ?? 0,
    minutes: Math.round(((f.duration_seconds ?? 0) / 60) * 10) / 10,
    error: f.error,
    txtError: f.txt_error,
  };
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en", { numeric: true });

export function buildReport(input: {
  date: string;
  dayFolderId: string | null;
  dayFolderPath: string | null;
  missingReason?: string | null;
  folders: FolderRow[];
  files: FileRow[];
  live: boolean;
  budgetExhausted: boolean;
}): NightlyReport {
  const inspectors: ReportInspector[] = input.folders
    .map((f) => {
      const files = input.files.filter((x) => x.inspector_folder_id === f.box_folder_id).sort(byName).map(toReportFile);
      return {
        folderId: f.box_folder_id,
        folderName: f.folder_name,
        matchKind: f.match_kind,
        staffName: f.staff_name,
        staffEmail: f.staff_email,
        files,
        missing: files.length === 0,
        notes: files.length === 0 ? f.notes_files ?? [] : [],
      };
    })
    .sort((a, b) => a.folderName.localeCompare(b.folderName));
  const loose = input.files.filter((x) => !x.inspector_folder_id).sort(byName).map(toReportFile);
  const all = [...inspectors.flatMap((i) => i.files), ...loose];

  const notices: Notice[] = [];
  const unmatchedMissing: string[] = [];
  for (const i of inspectors.filter((x) => x.missing)) {
    if (i.matchKind === "match" && i.staffEmail && i.staffName) {
      const key = i.staffEmail.toLowerCase();
      let n = notices.find((x) => x.email.toLowerCase() === key);
      if (!n) notices.push((n = { staffName: i.staffName, email: i.staffEmail, folders: [] }));
      n.folders.push({ id: i.folderId, name: i.folderName, notes: i.notes });
    } else unmatchedMissing.push(i.folderName);
  }

  return {
    date: input.date,
    dayFolderId: input.dayFolderId,
    dayFolderPath: input.dayFolderPath,
    missingReason: input.missingReason ?? null,
    inspectors,
    loose,
    totals: {
      recordings: all.length,
      transcribed: all.filter((f) => f.status === "done").length,
      failed: all.filter((f) => f.status === "failed").length,
      left: all.filter((f) => f.status === "queued" || f.status === "transcribing").length,
      flags: all.reduce((n, f) => n + f.flags, 0),
      minutes: Math.round(all.reduce((n, f) => n + f.minutes, 0)),
    },
    budgetExhausted: input.budgetExhausted,
    notices,
    live: input.live,
    unmatchedMissing,
  };
}

// ── Emails ────────────────────────────────────────────────────────────────────────────────
// Deliberately plain: a table of names and numbers the report team reads on a phone at 7am.

const CELL = 'style="padding:4px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top"';

function statusText(f: ReportFile): string {
  if (f.status === "done") return f.flags ? `Transcribed · ${f.flags} to check` : "Transcribed";
  if (f.status === "failed") return `Failed: ${f.error ?? "unknown error"}`;
  if (f.status === "skipped") return "Not transcribed (nightly limit reached)";
  return "Still queued";
}

function who(i: ReportInspector): string {
  if (i.matchKind === "match" && i.staffName) return `${i.folderName} · ${i.staffName}`;
  if (i.matchKind === "ambiguous") return `${i.folderName} · initials match more than one inspector`;
  return `${i.folderName} · not a current inspector's initials`;
}

export function renderDailyReport(r: NightlyReport, toolUrl: string): { subject: string; html: string } {
  const missing = r.inspectors.filter((i) => i.missing);
  const parts = [`${r.totals.transcribed} transcribed`];
  if (missing.length) parts.push(`${missing.length} missing`);
  if (r.totals.failed) parts.push(`${r.totals.failed} failed`);
  const subject = `Dictations for ${displayDate(r.date)}: ${parts.join(", ")}`;

  const rows: string[] = [];
  for (const i of r.inspectors) {
    const flag = !i.missing
      ? ""
      : i.notes.length
        ? ` — <span style="color:#e8642a"><strong>no recording</strong></span> (written notes: ${escapeHtml(i.notes.join(", "))})`
        : ' — <span style="color:#e8642a"><strong>no recording</strong></span>';
    const head = `<tr><td colspan="2" ${CELL}><strong>${escapeHtml(who(i))}</strong>${flag}</td></tr>`;
    rows.push(head);
    for (const f of i.files) rows.push(`<tr><td ${CELL}>${escapeHtml(f.name)}</td><td ${CELL}>${escapeHtml(statusText(f))}</td></tr>`);
  }
  if (r.loose.length) {
    rows.push(`<tr><td colspan="2" ${CELL}><strong>Not in a job folder</strong></td></tr>`);
    for (const f of r.loose) rows.push(`<tr><td ${CELL}>${escapeHtml(f.name)}</td><td ${CELL}>${escapeHtml(statusText(f))}</td></tr>`);
  }

  const notes: string[] = [];
  if (r.budgetExhausted) notes.push("The nightly transcription limit was reached — the rest can be run from the Manual tab.");
  if (r.totals.left) notes.push(`${r.totals.left} recording(s) were still in progress when this was sent; they will appear in the tool when done.`);
  if (r.notices.length) {
    const list = r.notices.map((n) => `${escapeHtml(n.staffName)} (${escapeHtml(n.email)}, ${n.folders.length} job${n.folders.length === 1 ? "" : "s"})`).join(", ");
    notes.push(r.live ? `Emailed about a missing recording: ${list}.` : `Would have emailed about a missing recording (inspector emails are off): ${list}.`);
  }
  if (r.unmatchedMissing.length) notes.push(`No one emailed for ${r.unmatchedMissing.map(escapeHtml).join(", ")} — the initials don't match exactly one current inspector.`);

  const box = r.dayFolderId ? ` · <a href="${escapeHtml(boxFolderUrl(r.dayFolderId))}">Box folder</a>` : "";
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#2f343a">
<p><strong>${escapeHtml(displayDate(r.date))}</strong> — ${r.totals.recordings} recording(s), ${r.totals.minutes} min, ${r.totals.transcribed} transcribed${r.totals.flags ? `, ${r.totals.flags} line(s) marked [CHECK]` : ""}.</p>
<p><a href="${escapeHtml(toolUrl)}">Open Transcription Buddy → Daily runs</a>${box}</p>
${notes.map((n) => `<p>${n}</p>`).join("\n")}
<table style="border-collapse:collapse;font-size:13px">${rows.join("")}</table>
</div>`;
  return { subject, html };
}

export function renderMissingNotice(n: Notice, date: string): { subject: string; html: string } {
  const first = n.staffName.replace(/\([^)]*\)/g, " ").trim().split(/\s+/)[0];
  const many = n.folders.length > 1;
  const subject = many ? `${n.folders.length} jobs with no recording for ${displayDate(date)}` : `No recording found for ${displayDate(date)}`;
  const items = n.folders
    .map((f) => `<li><a href="${escapeHtml(boxFolderUrl(f.id))}">${escapeHtml(f.name)}</a>${f.notes.length ? ` (has notes: ${escapeHtml(f.notes.join(", "))})` : ""}</li>`)
    .join("");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#2f343a">
<p>Hi ${escapeHtml(first)},</p>
<p>${many ? "These job folders" : "This job folder"} for ${escapeHtml(displayDate(date))} ${many ? "have" : "has"} no audio recording in ${many ? "them" : "it"}:</p>
<ul>${items}</ul>
<p>Could you upload the dictation today so the report can be typed?</p>
<p>Thanks,<br>AusDilaps Reports</p>
</div>`;
  return { subject, html };
}
