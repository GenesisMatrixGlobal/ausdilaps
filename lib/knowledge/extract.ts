import "server-only";
import { chunkMarkdown, chunkPlainText, chunkTranscript, type Chunk } from "./chunk";
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, type SourceFormat } from "./formats";

// Re-exported so server callers keep importing everything upload-related from one place.
export { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES, type SourceFormat };

/**
 * Getting searchable text out of whatever someone uploaded.
 *
 * Scope is deliberately narrow: the formats real training material actually arrives in.
 * Anything else is refused with a message that says what to do instead, because a silent
 * "0 chunks indexed" is worse than a refusal — it looks like the upload worked.
 */

export type Extracted = {
  text: string;
  format: SourceFormat;
  /** Shown in the admin row. Not an error — the upload still worked. */
  warning?: string;
};

/** Thrown when we understood the file but got nothing usable out of it. */
export class UnreadableUpload extends Error {}

/** Frontmatter is metadata, not content — indexing it pollutes results with YAML. */
function stripFrontmatter(text: string): string {
  return text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i).toLowerCase();
}

/**
 * PDF text-layer extraction.
 *
 * A scanned PDF is an image and yields nothing. That case is REPORTED rather than left to
 * look like an empty document, because "your PDF has no text layer, paste the text
 * instead" is actionable and "0 chunks" is not. OCR via Claude vision is the fast follow —
 * lib/property-sizing/ocr.ts is the pattern.
 */
async function extractPdf(bytes: ArrayBuffer): Promise<Extracted> {
  const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text, totalPages } = await pdfText(pdf, { mergePages: true });

  const merged = (Array.isArray(text) ? text.join("\n\n") : text).trim();
  if (merged.length < 40) {
    throw new UnreadableUpload(
      `That PDF has no text layer — it's ${totalPages} page(s) of images, most likely a scan. ` +
        `Paste the text in instead, or upload a text-based copy.`
    );
  }

  // pdf.js emits a newline per layout line, which turns every wrapped sentence into its
  // own "paragraph" and wrecks the paragraph-boundary splitting. Rejoin lines that are
  // clearly mid-sentence; keep breaks that follow terminal punctuation or a bullet.
  const reflowed = merged
    .replace(/\r\n?/g, "\n")
    .replace(/-\n(?=\p{Ll})/gu, "")               // de-hyphenate across a line break
    .replace(/([^\n.!?:;•\-•])\n(?!\n)(?=[a-z(])/gu, "$1 ")
    .replace(/\n{3,}/g, "\n\n");

  return {
    text: reflowed,
    format: "plain",
    warning: totalPages > 60 ? `Long document (${totalPages} pages) — check the chunk count looks right.` : undefined,
  };
}

export async function extractUpload(filename: string, bytes: ArrayBuffer): Promise<Extracted> {
  if (bytes.byteLength === 0) throw new UnreadableUpload("That file is empty.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new UnreadableUpload(
      `That file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_UPLOAD_LABEL} — split it, or upload the transcript instead of the video.`
    );
  }

  const ext = extensionOf(filename);
  if (!ACCEPTED_EXTENSIONS.includes(ext as (typeof ACCEPTED_EXTENSIONS)[number])) {
    throw new UnreadableUpload(
      `Can't read "${ext || "a file with no extension"}". Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}. ` +
        `For anything else, paste the text in.`
    );
  }

  if (ext === ".pdf") return extractPdf(bytes);

  const text = new TextDecoder("utf-8").decode(bytes);
  if (!text.trim()) throw new UnreadableUpload("That file has no text in it.");

  if (ext === ".vtt" || ext === ".srt") return { text, format: "transcript" };
  if (ext === ".md" || ext === ".mdx") return { text: stripFrontmatter(text), format: "markdown" };
  return { text, format: "plain" };
}

/** Routes text to the right chunker. The one place format→chunker is decided. */
export function chunkFor(format: SourceFormat, text: string): Chunk[] {
  if (format === "transcript") return chunkTranscript(text);
  if (format === "markdown") return chunkMarkdown(text);
  return chunkPlainText(text);
}

/**
 * Best guess at the format of pasted text, so someone pasting a transcript doesn't have to
 * tell us it's a transcript.
 *
 * Conservative on purpose: it only claims "transcript" when it sees actual cue timings,
 * and only "markdown" on a real ATX heading. Guessing wrong costs worse chunks and, for a
 * transcript, loses every timestamp.
 */
export function detectFormat(text: string): SourceFormat {
  const head = text.slice(0, 4000);
  if (/^\s*WEBVTT/m.test(head) || /\d{1,2}:\d{2}[.,]\d{1,3}\s*-->/.test(head)) return "transcript";
  if (/^#{1,3}\s+\S/m.test(head)) return "markdown";
  return "plain";
}
