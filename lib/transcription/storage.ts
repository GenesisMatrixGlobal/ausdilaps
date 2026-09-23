import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACCEPTED_AUDIO_MIME, DICTATION_BUCKET } from "./config";

// The audio's brief home between the browser and Deepgram.
//
// Same trust model as the knowledge bucket (0009): private, NO storage.objects policies,
// every write on a server-minted signed URL and every read a server-minted signed link. A
// signed upload URL carries its own token, so the anon key alone can reach nothing here.

let ensured = false;

/**
 * Creates the bucket if it is missing. Idempotent and cached per process.
 *
 * Migration 0019 creates it too, for the ledger — but every migration here is a hand-paste
 * into the SQL editor while the Management API token is expired, and a tool that 500s until
 * someone remembers to paste is a tool that looks broken on launch day. Whichever runs first
 * wins; the other is a no-op.
 */
export async function ensureDictationBucket(): Promise<void> {
  if (ensured) return;
  const db = createAdminClient();
  // No fileSizeLimit here, deliberately: the bucket inherits the project's global upload
  // limit, and asking for MORE than that fails the whole createBucket call ("The object
  // exceeded the maximum allowed size"). The route enforces MAX_AUDIO_BYTES itself.
  const { error } = await db.storage.createBucket(DICTATION_BUCKET, {
    public: false,
    allowedMimeTypes: [...ACCEPTED_AUDIO_MIME],
  });
  // "already exists" arrives as an error, not a success — that is the normal case.
  if (error && !/exist/i.test(error.message)) throw new Error(`Could not create the ${DICTATION_BUCKET} bucket: ${error.message}`);
  // The live bucket was left carrying a 100 MB per-file limit by a half-failed first create.
  // Clear it so the PROJECT's upload limit is the only ceiling and raising that setting in the
  // dashboard is enough — otherwise a 110 MB file fails here even after the project allows it.
  // Best effort: a refusal leaves the bucket as it was.
  const { error: limitError } = await db.storage.updateBucket(DICTATION_BUCKET, {
    public: false,
    fileSizeLimit: null,
    allowedMimeTypes: [...ACCEPTED_AUDIO_MIME],
  });
  if (limitError) console.warn(`[transcription] could not clear the ${DICTATION_BUCKET} bucket's file size limit: ${limitError.message}`);
  ensured = true;
}

/** Object key: a fresh folder per upload so two operators dropping "site.mp3" never collide. */
export function objectPathFor(filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 150) || "audio";
  return `${randomUUID()}/${safe}`;
}

/** What the transcribe route accepts as a path — exactly the shape objectPathFor() produces,
 *  so a caller can name only objects in this bucket's layout, never a path with `..` in it. */
export const OBJECT_PATH_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]{1,150}$/;

export async function signedUploadFor(path: string): Promise<{ token: string; signedUrl: string }> {
  const db = createAdminClient();
  const { data, error } = await db.storage.from(DICTATION_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Could not prepare the upload: ${error?.message ?? "no data"}`);
  return { token: data.token, signedUrl: data.signedUrl };
}

/** A short-lived link Deepgram fetches the audio from. Never handed to the browser. */
export async function signedDownloadFor(path: string, expiresInSeconds = 900): Promise<string> {
  const db = createAdminClient();
  const { data, error } = await db.storage.from(DICTATION_BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) throw new Error(`Could not read the upload back: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

/** Best effort; a leftover object is a few MB of storage, not a correctness problem. */
export async function removeAudio(path: string): Promise<void> {
  try {
    const db = createAdminClient();
    const { error } = await db.storage.from(DICTATION_BUCKET).remove([path]);
    if (error) console.warn(`[transcription] could not delete ${path}: ${error.message}`);
  } catch (e) {
    console.warn(`[transcription] could not delete ${path}: ${(e as Error).message}`);
  }
}
