import "server-only";
import { getAccessToken } from "@/lib/box";
import { isAudioName, listFolderEntries, type BoxEntry } from "../box-source";
import { matchesDay, matchesMonth, matchesYear } from "./dates";

// Walks Inspector Uploads to one day: <year> / <month> / <day> ("2026" / "09. September" /
// "220926"), then every JOB folder in it — one per job, named "<initials> - <job number> - <type>
// - <address>", e.g. "RG - 37472-00039595-01 - Pre-Con - Standard - 27 Beenwerrin Crescent
// CAPALABA". Free — Box listing calls only. Run on every tick, so a recording uploaded at 5am is
// still picked up by the 5:10 tick.
//
// The recording sits at the TOP of the job folder, beside the photo subfolders and the .xlsm
// (checked across three real days, 2026-09-23). Subfolders are searched only when the top level
// has no audio — one job in 42 had its MP3 a level down — because the photo subfolders hold
// thousands of files and listing every one of them on every tick would be most of the tick.

export class DayFolderError extends Error {}

export type FoundFile = { fileId: string; name: string; size: number; parentId: string };
export type FoundFolder = {
  folderId: string;
  name: string;
  files: FoundFile[];
  /** Written notes in a folder with NO recording ("No changes noted.txt", "5 norman st
   *  notes.docx") — typical of a post-con with nothing to report. Shown beside "no recording" so
   *  the report team can tell a forgotten dictation from a job that did not need one. */
  notes: string[];
};
export type DayListing = {
  dayFolder: { id: string; path: string } | null;
  /** Why there is no day folder, in words — "no 2026 folder", "no folder for 22 Sep". */
  missingReason?: string;
  folders: FoundFolder[];
  /** Recordings dropped straight into the day folder rather than a job folder. */
  loose: FoundFile[];
};

const NOTE_FILE = /\.(txt|docx?|md|rtf)$/i;

function pick(entries: BoxEntry[], test: (name: string) => boolean, what: string): BoxEntry | null {
  const hits = entries.filter((e) => e.type === "folder" && test(e.name));
  if (hits.length > 1) throw new DayFolderError(`More than one ${what} folder matches: ${hits.map((h) => `"${h.name}"`).join(", ")}.`);
  return hits[0] ?? null;
}

function audioIn(entries: BoxEntry[], parentId: string): FoundFile[] {
  return entries
    .filter((e) => e.type === "file" && isAudioName(e.name))
    .map((e) => ({ fileId: e.id, name: e.name, size: e.size ?? 0, parentId }));
}

async function jobFolder(id: string, name: string, headers: Record<string, string>): Promise<FoundFolder> {
  const entries = await listFolderEntries(id, headers);
  const files = audioIn(entries, id);
  if (files.length === 0) {
    for (const sub of entries.filter((e) => e.type === "folder")) files.push(...audioIn(await listFolderEntries(sub.id, headers), sub.id));
  }
  const notes = files.length ? [] : entries.filter((e) => e.type === "file" && NOTE_FILE.test(e.name)).map((e) => e.name);
  return { folderId: id, name, files, notes };
}

export async function discoverDay(rootFolderId: string, date: string): Promise<DayListing> {
  const headers = { Authorization: `Bearer ${await getAccessToken()}` };
  const [y, m] = date.split("-").map(Number);

  const years = await listFolderEntries(rootFolderId, headers);
  const year = pick(years, (n) => matchesYear(n, y), "year");
  if (!year) return { dayFolder: null, missingReason: `no ${y} folder`, folders: [], loose: [] };
  const month = pick(await listFolderEntries(year.id, headers), (n) => matchesMonth(n, y, m), "month");
  if (!month) return { dayFolder: null, missingReason: `no month folder in ${year.name}`, folders: [], loose: [] };
  const day = pick(await listFolderEntries(month.id, headers), (n) => matchesDay(n, date), "day");
  if (!day) return { dayFolder: null, missingReason: `no day folder in ${year.name} / ${month.name}`, folders: [], loose: [] };

  const entries = await listFolderEntries(day.id, headers);
  const folders: FoundFolder[] = [];
  for (const f of entries.filter((e) => e.type === "folder")) folders.push(await jobFolder(f.id, f.name, headers));
  const loose = entries
    .filter((e) => e.type === "file" && isAudioName(e.name))
    .map((e) => ({ fileId: e.id, name: e.name, size: e.size ?? 0, parentId: day.id }));
  return { dayFolder: { id: day.id, path: `${year.name} / ${month.name} / ${day.name}` }, folders, loose };
}
