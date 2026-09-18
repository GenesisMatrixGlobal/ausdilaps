// The mis-hearing pass: Claude reads the timestamped transcript and fixes ONLY the words the
// speech-to-text plainly got wrong, using the same vocabulary Deepgram was prompted with and
// the address off the file name. It never rewrites into report style — the type-pre-report
// skill owns that and wants the inspector's own words as its source of truth.
//
// Degrades, never blocks: any failure hands the raw transcript back unchanged with
// `changed: false`, and the UI says so. Same rule as the knowledge base's AI path.

import { recordApiCall, type AnthropicUsage } from "@/lib/api-usage";
import { CLEANUP_MODEL } from "./config";
import { timestampLines } from "./format";
import { DICTATION_KEYTERMS, keytermsFor } from "./keyterms";

export type CleanupResult = { text: string; changed: boolean; note?: string };

const SYSTEM = `You tidy speech-to-text transcripts of an Australian building inspector dictating a dilapidation (building condition) inspection on site. The inspector walks a property photo by photo, saying what each photo shows: walls by compass direction, ceilings, floors, yards, fences, retaining walls, cracks and gaps.

Your ONLY job is to correct words the speech-to-text plainly misheard. Typical mis-hearings: "yacht" for "yard", "tile flows" / "tile close" for "tile floors", "Roman" for "room one", "print inspection" for "pre-inspection", "base station" / "bridge station" for "vegetation", "carriage" for "garage", "capital floor" / "carpenter floor" for "carpet floor", "end suite" for "ensuite", "for number" / "photo #" for "photo number", a suburb or street name rendered as unrelated English words.

Rules:
- Keep EVERY line. Keep every timestamp line exactly as it is, in the same order. Do not merge, split, add or remove lines.
- Keep the inspector's phrasing, repetition and word order. Do not paraphrase, tidy grammar, or rewrite into report style. "Again the west wall of the house" stays exactly that.
- Do not add observations, defects, directions or room names that were not said. Do not remove any.
- Correct a word only when you are confident it is a mis-hearing of a term the inspector would actually say. When unsure, leave it.
- The file name usually carries the property address; use it to fix the address where the transcript garbled it.
- Return ONLY the corrected transcript text, in the same layout, with no preamble, explanation or markdown.`;

export async function cleanTranscript(input: { raw: string; filename: string }): Promise<CleanupResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { text: input.raw, changed: false, note: "Clean-up not configured" };

  try {
    const hint = keytermsFor(input.filename);
    const userText = [
      `File name: ${input.filename}`,
      hint.length ? `Likely address words: ${hint.join(", ")}` : "",
      `Vocabulary the inspector uses: ${DICTATION_KEYTERMS.join(", ")}`,
      "",
      "Transcript:",
      input.raw,
    ]
      .filter((l) => l !== "")
      .join("\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: CLEANUP_MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        // A copy-edit, not a reasoning task: "low" returns the same fixes in a fraction of the time.
        output_config: { effort: "low" },
        system: SYSTEM,
        messages: [{ role: "user", content: userText }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      stop_reason?: string;
      content?: Array<{ type: string; text?: string }>;
      usage?: AnthropicUsage;
    };
    void recordApiCall({ provider: "anthropic", api: "messages", model: CLEANUP_MODEL, usage: data.usage });

    if (data.stop_reason === "refusal") throw new Error("declined");
    if (data.stop_reason === "max_tokens") throw new Error("ran out of room");

    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    if (!text) throw new Error("empty");

    // The one structural invariant: every timestamp, in order. A model that dropped or
    // reordered a line has done more than fix words, and the raw is the safer thing to show.
    const before = timestampLines(input.raw);
    const after = timestampLines(text);
    if (before.length !== after.length || before.some((t, i) => t !== after[i])) {
      throw new Error(`timestamps changed (${before.length} → ${after.length})`);
    }

    return { text, changed: text !== input.raw.trim() };
  } catch (e) {
    console.warn(`[transcription] clean-up skipped: ${(e as Error).message}`);
    return { text: input.raw, changed: false, note: "Clean-up unavailable — showing the raw transcript" };
  }
}
