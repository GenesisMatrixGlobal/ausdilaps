import "server-only";
import { getAccessToken } from "@/lib/box";
import { isAudioName, listFolderEntries, type BoxEntry } from "../box-source";
import { matchesDay, matchesMonth, matchesYear } from "./dates";

// Walks Inspector Uploads to one day: <year> / <month> / <day>, then every inspector folder in
// it. Free — Box listing calls only. Run on every tick, so a recording uploaded at 5am is still
// picked up by the 5:10 tick.

export class DayFolderError extends Error {}

export type FoundFile = { fileId: string; name: string; size: number; parentId: string };
export type FoundFolder = { folderId: string; name: string; files: FoundFile[] };
export type DayListing = {
  dayFolder: { id: string; path: string } | null;
  /** Why there is no day folder, in words — "no 2026 folder", "no folder for 22 Sep". */
  missingReason?: string;
  folders: FoundFolder[];
  /** Recordings dropped straight into the day folder rather than an inspector's. */
  loose: FoundFile[];
};

/** Subfolders below an inspector's folder that are searched too, e.g. one per job. */
const MAX_DEPTH = 2;

function pick(entries: BoxEntry[], test: (name: string) => boolean, what: string): BoxEntry | null {
  const hits = entries.filter((e) => e.type === "folder" && test(e.name));
  if (hits.length > 1) throw new DayFolderError(`More than one ${what} folder matches: ${hits.map((h) => `"${h.name}"`).join(", ")}.`);
  return hits[0] ?? null;
}

async function audioUnder(folderId: string, headers: Record<string, string>, depth: number): Promise<FoundFile[]> {
  const entries = await listFolderEntries(folderId, headers);
  const files: FoundFile[] = entries
    .filter((e) => e.type === "file" && isAudioName(e.name))
    .map((e) => ({ fileId: e.id, name: e.name, size: e.size ?? 0, parentId: folderId }));
  if (depth < MAX_DEPTH) {
    for (const sub of entries.filter((e) => e.type === "folder")) files.push(...(await audioUnder(sub.id, headers, depth + 1)));
  }
  return files;
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
  for (const f of entries.filter((e) => e.type === "folder")) {
    folders.push({ folderId: f.id, name: f.name, files: await audioUnder(f.id, headers, 1) });
  }
  const loose = entries
    .filter((e) => e.type === "file" && isAudioName(e.name))
    .map((e) => ({ fileId: e.id, name: e.name, size: e.size ?? 0, parentId: day.id }));
  return { dayFolder: { id: day.id, path: `${year.name} / ${month.name} / ${day.name}` }, folders, loose };
}
