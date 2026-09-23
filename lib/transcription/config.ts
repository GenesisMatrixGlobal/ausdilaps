// Transcription Buddy — constants shared by the routes, the registry and the client.
//
// Deliberately free of server-only imports: lib/tools/registry.ts imports
// TRANSCRIPTION_DEPARTMENTS from here so the tool card and its API can never disagree about
// who has access (the Tender Watch arrangement), and the registry is bundled everywhere.

import type { DepartmentSlug } from "@/lib/departments";

export const TRANSCRIPTION_TOOL_SLUG = "transcription-buddy";

/** Who sees the tool AND who its API routes admit. Must match the registry entry. */
export const TRANSCRIPTION_DEPARTMENTS: readonly DepartmentSlug[] = ["reports"];

/** Dev-only unauth hatch. IGNORED in production — see lib/auth/is-staff.ts. */
export const TRANSCRIPTION_ALLOW_UNAUTHED_ENV = "TRANSCRIPTION_ALLOW_UNAUTHED";

/** Private Supabase Storage bucket the browser uploads into on a signed URL. Objects live
 *  only for the seconds between upload and transcription — the transcribe route deletes them. */
export const DICTATION_BUCKET = "dictation";

/** Vercel's serverless body cap is 4.5 MB, which is why the audio never touches our routes:
 *  the browser PUTs it straight to Storage and Deepgram fetches it from there. So this is the
 *  only size ceiling in OUR code. ⚠️ The Supabase PROJECT has its own global upload limit
 *  (Dashboard → Project Settings → Storage → "Upload file size limit"), and a file over THAT
 *  fails at the PUT with a Storage error however high this number is — it was 50 MB and a
 *  110 MB dictation was refused on 2026-09-23; this cap and that setting move together. A bucket
 *  may not be given a higher per-file limit than the project's ("The object exceeded the
 *  maximum allowed size" from createBucket), so the bucket carries none and inherits it.
 *  200 MB is ~3.5 hours of 128 kbps MP3; Deepgram accepts up to 2 GB. */
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

/** MP3 is the ask; the others cost nothing to accept and phones produce them. */
export const ACCEPTED_AUDIO_MIME = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
] as const;

export const ACCEPTED_AUDIO_EXTENSIONS = [".mp3", ".m4a", ".mp4", ".aac", ".wav", ".webm", ".ogg"] as const;

export const DEEPGRAM_MODEL = "nova-3";

/** Nova-3 supports en-AU directly. Overridable in case a future model does not. */
export const DEEPGRAM_LANGUAGE = process.env.DEEPGRAM_LANGUAGE ?? "en-AU";

/** The mis-hearing pass. Opus reads a 15-minute dictation (~3k tokens each way) for ~5c. */
export const CLEANUP_MODEL = process.env.TRANSCRIPTION_CLEANUP_MODEL ?? "claude-opus-5";
