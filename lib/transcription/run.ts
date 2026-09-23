import "server-only";
import { transcribeUrl } from "./deepgram";
import { keytermsForFile } from "./keyterms";
import { formatTranscript } from "./format";
import { cleanTranscript } from "./cleanup";
import { linesRemoved, trimForTyping } from "./trim";

// The whole pipeline from "a URL Deepgram can fetch" to the payload the tool renders. ONE
// function, because two routes feed it — a Storage signed link for a dropped file, a Box
// download URL for a filed one — and the transcript must come out identical either way.

export type TranscriptPayload = {
  raw: string;
  cleaned: string;
  typing: string;
  typingRemoved: number;
  cleanedChanged: boolean;
  cleanupNote: string | null;
  durationSeconds: number;
  /** At list — the same figures the api_calls rows carry, so the row and /admin/usage agree. */
  costCents: number;
  costBreakdown: { deepgramCents: number; anthropicCents: number };
};

export async function transcribeFromUrl(audioUrl: string, name: string): Promise<TranscriptPayload> {
  const result = await transcribeUrl(audioUrl, keytermsForFile(name));
  const raw = formatTranscript({ name, utterances: result.utterances });
  const cleaned = await cleanTranscript({ raw, filename: name });
  // Cleaned first (it needs every line for its timestamp invariant), then the deterministic
  // strip of everything the typing skill does not read — greeting, weather, sign-off, fillers.
  const typing = trimForTyping(cleaned.text);
  return {
    raw,
    cleaned: cleaned.text,
    typing,
    typingRemoved: linesRemoved(cleaned.text, typing),
    cleanedChanged: cleaned.changed,
    cleanupNote: cleaned.note ?? null,
    durationSeconds: result.durationSeconds,
    costCents: Math.round((result.costCents + cleaned.costCents) * 100) / 100,
    costBreakdown: { deepgramCents: result.costCents, anthropicCents: cleaned.costCents },
  };
}
