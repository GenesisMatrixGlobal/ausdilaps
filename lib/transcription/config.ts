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
