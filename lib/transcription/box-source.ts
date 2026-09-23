import "server-only";
import { getAccessToken } from "@/lib/box";
import { ACCEPTED_AUDIO_EXTENSIONS } from "./config";
import type { BoxLink } from "./box-link";

// Recordings live in Box, and are transcribed from there.
//
// The team files every job's audio in Box, so the tool reads it in place: Box is asked for a
// file's short-lived DOWNLOAD URL — `GET /files/:id/content` answers with a 302 to a
// dl.boxcloud.com address that works for a few minutes without any token — and that address is
// handed to Deepgram. Nothing is copied, nothing passes through a Vercel function, and Box's
// own 5 GB ceiling is the only size limit. A folder link lists every audio file in it, so a
// whole job is one paste.
//
// The service account (BOX_CLIENT_*) does the reading, so it has to be able to see the file —
// it can see the job folders it files markups into. A shared link it cannot see directly is
// opened through the link itself (`BoxApi: shared_link=`), and every file listed under a shared
// folder carries that link so its download works the same way. A file the account cannot open
// is a plain BoxSourceError, never a stack trace.

export class BoxSourceError extends Error {}

export type BoxAudioFile = {
  fileId: string;
  name: string;
  size: number;
  /** The shared link this file was reached through, when the account has no direct access. */
  sharedUrl?: string;
};

type BoxItem = BoxEntry;

const AUDIO_EXT = new Set<string>(ACCEPTED_AUDIO_EXTENSIONS);

export function isAudioName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && AUDIO_EXT.has(name.slice(dot).toLowerCase());
}

/** What a pasted link points at: one recording, or every recording in a folder (top level only,
 *  Box's name order). A folder with no audio comes back as an empty list, not an error. */
export async function listBoxAudio(link: BoxLink): Promise<{ kind: "file" | "folder"; folderName?: string; files: BoxAudioFile[] }> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let target: BoxItem;
  let sharedUrl: string | undefined;
  if (link.kind === "shared") {
    headers.BoxApi = `shared_link=${link.url}`;
    sharedUrl = link.url;
    target = await boxJson<BoxItem>("https://api.box.com/2.0/shared_items?fields=id,type,name,size", headers);
  } else if (link.kind === "file") {
    target = await boxJson<BoxItem>(`https://api.box.com/2.0/files/${link.fileId}?fields=id,type,name,size`, headers);
  } else {
    target = await boxJson<BoxItem>(`https://api.box.com/2.0/folders/${link.folderId}?fields=id,type,name`, headers);
  }

  if (target.type === "file") {
    if (!isAudioName(target.name)) throw new BoxSourceError(`"${target.name}" isn't an audio file.`);
    return { kind: "file", files: [{ fileId: target.id, name: target.name, size: target.size ?? 0, sharedUrl }] };
  }
  if (target.type !== "folder") throw new BoxSourceError("That Box link isn't a file or a folder.");

  const files: BoxAudioFile[] = (await listFolderEntries(target.id, headers))
    .filter((e) => e.type === "file" && isAudioName(e.name))
    .map((e) => ({ fileId: e.id, name: e.name, size: e.size ?? 0, sharedUrl }));
  return { kind: "folder", folderName: target.name, files };
}

export type BoxEntry = { id: string; type: "file" | "folder" | "web_link"; name: string; size?: number };

/** Everything directly in a folder, Box's name order. Paged, and NOT cached: lib/box's
 *  listFolderItems carries revalidate: 1800 for the samples page, and a recording uploaded a
 *  minute ago has to show up here. Shared by the Manual tab and the nightly crawl. */
export async function listFolderEntries(folderId: string, headers?: Record<string, string>): Promise<BoxEntry[]> {
  const h = headers ?? { Authorization: `Bearer ${await getAccessToken()}` };
  const out: BoxEntry[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await boxJson<{ entries: BoxEntry[]; total_count: number }>(
      `https://api.box.com/2.0/folders/${folderId}/items?fields=id,type,name,size&limit=1000&offset=${offset}&sort=name&direction=ASC`,
      h
    );
    out.push(...page.entries);
    if (offset + 1000 >= page.total_count) break;
  }
  return out;
}

export type BoxAudioSource = { name: string; size: number; downloadUrl: string };

/** The short-lived download URL Deepgram fetches from. `redirect: "manual"` keeps the bytes out
 *  of this function — following the 302 would download the whole recording here. */
export async function resolveBoxAudio(fileId: string, sharedUrl?: string): Promise<BoxAudioSource> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (sharedUrl) headers.BoxApi = `shared_link=${sharedUrl}`;
  const file = await boxJson<BoxItem>(`https://api.box.com/2.0/files/${fileId}?fields=id,type,name,size`, headers);
  if (file.type !== "file") throw new BoxSourceError("That Box link is a folder, not a file.");
  const res = await fetch(`https://api.box.com/2.0/files/${fileId}/content`, { headers, redirect: "manual" });
  const location = res.headers.get("location");
  if (res.status !== 302 || !location) {
    if (res.status === 403 || res.status === 404) throw new BoxSourceError(CANNOT_OPEN);
    throw new Error(`Box download URL request failed: ${res.status}`);
  }
  return { name: file.name, size: file.size ?? 0, downloadUrl: location };
}

const CANNOT_OPEN = "Box wouldn't let this account open that. Check it is in a job folder the AusDilaps integration can see, or share it with a link.";

async function boxJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers, cache: "no-store" });
  if (res.status === 403 || res.status === 404) throw new BoxSourceError(CANNOT_OPEN);
  if (!res.ok) throw new Error(`Box API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}
