import "server-only";
import { getAccessToken } from "@/lib/box";
import type { BoxFileLink } from "./box-link";

export { parseBoxFileLink, type BoxFileLink } from "./box-link";

// A recording that already lives in Box, transcribed from there.
//
// The team files every job's audio in Box, so making them download a file and drop it back in
// here duplicated the bytes for nothing. Instead Box is asked for the file's short-lived
// DOWNLOAD URL — `GET /files/:id/content` answers with a 302 to a dl.boxcloud.com address that
// works for a few minutes without any token — and that address is handed to Deepgram exactly as
// the Storage signed link is. Nothing is copied, nothing passes through a Vercel function, and
// Box's own 5 GB ceiling replaces ours.
//
// The service account (BOX_CLIENT_*) reads the file, so it has to be able to see it. It can
// see the job folders it files markups into. A link it cannot open comes back as a plain
// "Box wouldn't let this account open that file" rather than a stack trace.

export type BoxAudioSource = {
  name: string;
  size: number;
  /** Short-lived direct download URL — hand it to Deepgram straight away. */
  downloadUrl: string;
};

type BoxFile = { id: string; type: string; name: string; size: number };

export class BoxSourceError extends Error {}

export async function resolveBoxAudio(link: BoxFileLink): Promise<BoxAudioSource> {
  const token = await getAccessToken();
  const auth: Record<string, string> = { Authorization: `Bearer ${token}` };
  // A shared link the account cannot see directly is opened through the link itself.
  if (link.kind === "shared") auth.BoxApi = `shared_link=${link.url}`;

  const file =
    link.kind === "file"
      ? await boxJson<BoxFile>(`https://api.box.com/2.0/files/${link.fileId}?fields=id,type,name,size`, auth)
      : await boxJson<BoxFile>("https://api.box.com/2.0/shared_items?fields=id,type,name,size", auth);
  if (file.type !== "file") throw new BoxSourceError("That Box link is a folder, not a file. Paste the link to the recording itself.");

  // The 302 target is the URL Deepgram will fetch. `redirect: "manual"` keeps the bytes out of
  // this function — following it would download the whole recording here.
  const res = await fetch(`https://api.box.com/2.0/files/${file.id}/content`, { headers: auth, redirect: "manual" });
  const location = res.headers.get("location");
  if (res.status !== 302 || !location) {
    if (res.status === 403 || res.status === 404) {
      throw new BoxSourceError("Box wouldn't let this account open that file. Check the file is shared with the AusDilaps integration, or share it with a link.");
    }
    throw new Error(`Box download URL request failed: ${res.status}`);
  }
  return { name: file.name, size: file.size, downloadUrl: location };
}

async function boxJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 404) {
    throw new BoxSourceError("Box wouldn't let this account open that file. Check the file is shared with the AusDilaps integration, or share it with a link.");
  }
  if (!res.ok) throw new Error(`Box API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}
