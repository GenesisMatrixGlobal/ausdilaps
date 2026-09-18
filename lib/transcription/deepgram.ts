// Deepgram Nova-3, pre-recorded. Raw fetch like every other provider call in this repo.
//
// The audio is handed over as a URL, never as bytes: Deepgram fetches it from the signed
// Storage link itself, so nothing bigger than a few KB of JSON ever passes through a Vercel
// function. A 15-minute dictation comes back in ~10-20 s.

import { recordApiCall } from "@/lib/api-usage";
import { DEEPGRAM_LANGUAGE, DEEPGRAM_MODEL } from "./config";
import type { Utterance } from "./format";

export function deepgramConfigured(): boolean {
  return !!process.env.DEEPGRAM_API_KEY;
}

export type DeepgramResult = {
  /** The whole recording as one string, as Deepgram punctuates it. */
  transcript: string;
  utterances: Utterance[];
  durationSeconds: number;
};

type DeepgramResponse = {
  metadata?: { duration?: number; model_info?: Record<string, { name?: string }> };
  results?: {
    channels?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
    utterances?: Array<{ start: number; end: number; transcript: string }>;
  };
};

export async function transcribeUrl(audioUrl: string, keyterms: readonly string[]): Promise<DeepgramResult> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY not configured");

  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    language: DEEPGRAM_LANGUAGE,
    smart_format: "true",
    punctuate: "true",
    utterances: "true",
    paragraphs: "true",
  });
  // One `keyterm` param per term — Deepgram reads repeats, not a delimited list.
  for (const term of keyterms) params.append("keyterm", term);

  const res = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ url: audioUrl }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Deepgram API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as DeepgramResponse;
  const durationSeconds = data.metadata?.duration ?? 0;
  void recordApiCall({
    provider: "deepgram",
    api: "listen",
    model: DEEPGRAM_MODEL,
    seconds: durationSeconds,
    keyterms: keyterms.length > 0,
  });

  const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  const utterances: Utterance[] = (data.results?.utterances ?? []).map((u) => ({
    start: u.start,
    end: u.end,
    text: u.transcript,
  }));

  if (!transcript.trim() && utterances.length === 0) {
    throw new Error("Deepgram returned no speech for that file. Is it silent, or not audio?");
  }
  // Utterances are what the layout is built from; if Deepgram ever withholds them, one
  // block at 00:00:00 still gives the operator the words.
  if (utterances.length === 0) utterances.push({ start: 0, end: durationSeconds, text: transcript });

  return { transcript, utterances, durationSeconds };
}
