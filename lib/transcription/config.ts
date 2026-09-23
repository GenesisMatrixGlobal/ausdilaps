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

/** Which files in a Box folder count as recordings. */
export const ACCEPTED_AUDIO_EXTENSIONS = [".mp3", ".m4a", ".mp4", ".aac", ".wav", ".webm", ".ogg", ".opus", ".flac"] as const;

export const DEEPGRAM_MODEL = "nova-3";

/** Nova-3 supports en-AU directly. Overridable in case a future model does not. */
export const DEEPGRAM_LANGUAGE = process.env.DEEPGRAM_LANGUAGE ?? "en-AU";

/** The mis-hearing pass. Opus reads a 15-minute dictation (~3k tokens each way) for ~5c. */
export const CLEANUP_MODEL = process.env.TRANSCRIPTION_CLEANUP_MODEL ?? "claude-opus-5";

// ── The nightly crawl (lib/transcription/nightly/*) ─────────────────────────────────────
// The inspectors' own uploads tree: <year> / <month> / <day> / <initials> / *.mp3. Every night
// yesterday's day folder is walked and every recording in it fed through the SAME pipeline the
// Manual tab uses (resolveBoxAudio → transcribeFromUrl), with its own log.

/** "Inspector Uploads" in Box. The service account must be a collaborator (Viewer Uploader:
 *  it reads the audio and files a .txt beside it, and cannot delete anything). */
export const NIGHTLY_UPLOADS_FOLDER_ID = process.env.TRANSCRIPTION_UPLOADS_FOLDER_ID ?? "304525890531";

/** The crawl starts at this hour, SYDNEY time, on yesterday's (Sydney) folder. The cron fires
 *  every 10 minutes across a UTC window that covers it in both AEST and AEDT; ticks before it
 *  do nothing. */
export const NIGHTLY_START_HOUR_SYDNEY = 4;

/** The morning report goes once the queue is empty, but never before this (Sydney) — so a
 *  recording uploaded in the first hour still counts before anyone is told it is missing. */
export const NIGHTLY_REPORT_EARLIEST_SYDNEY = { hour: 5, minute: 0 };

/** The morning report goes at this Sydney time even if files are still queued — Brittany wants
 *  everything by 7am, and a report that waits for a stuck file never arrives. */
export const NIGHTLY_REPORT_BY_SYDNEY = { hour: 6, minute: 30 };

/** Audio minutes transcribed per night, at most. A mis-filed five-hour recording or a folder of
 *  two hundred cannot run the bill up; what is left over is reported, not dropped. */
export const NIGHTLY_MAX_MINUTES = Number(process.env.TRANSCRIPTION_NIGHTLY_MAX_MINUTES) || 600;

/** A file is tried this many times across ticks before it is reported as failed. */
export const NIGHTLY_MAX_ATTEMPTS = 3;

/** Files transcribed at once inside one tick — the Manual tab's figure. */
export const NIGHTLY_CONCURRENCY = 3;
