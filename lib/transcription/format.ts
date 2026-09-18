// The transcript layout, pure.
//
// This is EXACTLY the layout Word's Transcribe feature produces, because that is what the
// report team's typing skill (type-pre-report) already reads: a header naming the audio file,
// then alternating timestamp and text lines. Change it and the downstream skill has to change
// with it. Pinned by scripts/check-transcript.ts.

export type Utterance = {
  /** Seconds from the start of the recording. */
  start: number;
  end: number;
  text: string;
};

export type TranscribedFile = {
  /** The audio file's name as dropped, e.g. "11 Emeraldwood st.mp3". */
  name: string;
  utterances: Utterance[];
};

/** `hh:mm:ss`, floored — Word prints whole seconds. */
export function timestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, "0")).join(":");
}

/** One file in the Word layout. Empty or whitespace-only utterances are skipped. */
export function formatTranscript(file: TranscribedFile): string {
  const lines = ["Audio file", file.name, "Transcript"];
  for (const u of file.utterances) {
    const text = u.text.trim();
    if (!text) continue;
    lines.push(timestamp(u.start), text);
  }
  return lines.join("\n");
}

/** Several files, separated the way the Word document separates them. */
export function formatBatch(blocks: string[]): string {
  return blocks.filter((b) => b.trim()).join("\n\n\n");
}

/** Timestamp lines in a formatted transcript — the invariant the clean-up pass must keep. */
export function timestampLines(text: string): string[] {
  return text.split("\n").filter((l) => /^\d{2}:\d{2}:\d{2}$/.test(l.trim()));
}
