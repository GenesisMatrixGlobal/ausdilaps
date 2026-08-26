/**
 * Turning a document into search units.
 *
 * The unit of retrieval is a CHUNK, not a file. "The estimator induction" is a useless
 * answer to a question; "14:22 — ring the subject lot first" is the product. So every
 * chunk carries what it needs to deep-link back to its exact position: an `anchor` for
 * prose, a `startSeconds` for transcripts.
 *
 * Pure string work — no fs, no network, no database. That is deliberate: it makes the
 * chunkers testable on their own (scripts/check-chunking.mjs) and keeps the slow,
 * failure-prone parts (upload, extract, insert) in lib/knowledge/ingest.ts.
 */

import { createHeadingSlugger } from "@/lib/slug";

export type Chunk = {
  ordinal: number;
  heading: string | null;
  content: string;
  /** Transcripts: the second this passage is spoken. Null for prose. */
  startSeconds: number | null;
  /** Prose: the heading slug to jump to. Null for transcripts. */
  anchor: string | null;
};

/**
 * ~1200 chars is roughly 300 tokens — big enough to hold a complete thought, small enough
 * that a citation points somewhere specific. Chunks much larger start answering "which
 * paragraph?" with "somewhere in this page".
 */
const MAX_CHARS = 1200;

/**
 * Enough to carry a sentence across a split, so a passage cut mid-thought is still
 * findable from either side.
 */
const OVERLAP_CHARS = 120;

/** Seconds of speech per transcript chunk. ~75s is a paragraph's worth at talking pace. */
const TRANSCRIPT_WINDOW_SECONDS = 75;

/** Trims, collapses runs of blank lines, and normalises line endings. */
function tidy(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Splits text that is too long for one chunk, preferring paragraph boundaries, then
 * sentence boundaries, and only cutting mid-sentence when a single sentence exceeds the
 * limit outright.
 */
function splitLong(text: string, max = MAX_CHARS, overlap = OVERLAP_CHARS): string[] {
  if (text.length <= max) return [text];

  // Paragraphs first. A paragraph over the limit is itself split into sentences, so the
  // unit being packed is always something that already fits.
  const units: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    if (para.length <= max) {
      units.push(para);
      continue;
    }
    let sentence = "";
    for (const part of para.split(/(?<=[.!?])\s+/)) {
      if (part.length > max) {
        // One sentence longer than a whole chunk. Rare (usually a wall of pasted text with
        // no punctuation); cut it on width rather than dropping it.
        if (sentence) {
          units.push(sentence);
          sentence = "";
        }
        for (let i = 0; i < part.length; i += max) units.push(part.slice(i, i + max));
        continue;
      }
      if (sentence.length + part.length + 1 > max) {
        units.push(sentence);
        sentence = part;
      } else {
        sentence = sentence ? `${sentence} ${part}` : part;
      }
    }
    if (sentence) units.push(sentence);
  }

  const out: string[] = [];
  let buf = "";
  for (const unit of units) {
    if (buf && buf.length + unit.length + 2 > max) {
      out.push(buf);
      // Carry the tail forward, snapped to a word boundary so the overlap doesn't start
      // mid-word and pollute the full-text index with fragments.
      const tail = buf.slice(-overlap);
      const snapped = tail.slice(tail.search(/\s/) + 1);
      // Only carry the tail if it still fits. Overlap improves recall at a split; the
      // length cap is what keeps a citation pointing somewhere specific, so it wins.
      const withOverlap = snapped ? `${snapped}\n\n${unit}` : unit;
      buf = withOverlap.length <= max ? withOverlap : unit;
    } else {
      buf = buf ? `${buf}\n\n${unit}` : unit;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * Markdown / MDX → chunks, split on `##` and `###`.
 *
 * `#` is deliberately NOT a split point: in these documents it's the page title, and
 * splitting on it would produce one chunk holding the entire body.
 *
 * Fenced code blocks are protected — a `## comment` inside a fence is not a heading, and
 * treating it as one splits a code sample in half.
 */
export function chunkMarkdown(source: string): Chunk[] {
  const lines = tidy(source).split("\n");

  const sections: { heading: string | null; anchor: string | null; body: string[] }[] = [
    { heading: null, anchor: null, body: [] },
  ];
  const slug = createHeadingSlugger();
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;

    const match = !inFence && /^(#{1,3})\s+(.+?)\s*#*$/.exec(line);
    if (match) {
      const [, hashes, text] = match;
      // Every heading is slugged, even `#`, because the renderer slugs every heading too
      // and the dedupe counters have to stay in step. Only h2/h3 start a new section.
      const anchor = slug(text.trim());
      if (hashes.length === 1) {
        sections[sections.length - 1].body.push(line);
      } else {
        sections.push({ heading: text.trim(), anchor, body: [] });
      }
    } else {
      sections[sections.length - 1].body.push(line);
    }
  }

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const body = tidy(section.body.join("\n"));
    if (!body) continue;

    for (const piece of splitLong(body)) {
      chunks.push({
        ordinal: chunks.length,
        heading: section.heading,
        content: piece,
        startSeconds: null,
        anchor: section.anchor,
      });
    }
  }
  return chunks;
}

/** Plain text with no headings — paste, or a .txt upload. */
export function chunkPlainText(source: string): Chunk[] {
  const body = tidy(source);
  if (!body) return [];
  return splitLong(body).map((content, ordinal) => ({
    ordinal,
    heading: null,
    content,
    startSeconds: null,
    anchor: null,
  }));
}

type Cue = { start: number; text: string };

/** `00:01:02.500` / `00:01:02,500` / `01:02.500` → seconds. */
function parseTimestamp(value: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(value.trim());
  if (!m) return null;
  const [, h, min, sec, ms] = m;
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec) + Number(ms.padEnd(3, "0")) / 1000;
}

/**
 * WebVTT and SRT share enough structure to parse together: a timing line containing
 * `-->`, with the caption text on the lines beneath it.
 *
 * Handles, because real exports contain all of them: SRT sequence numbers, VTT cue
 * settings after the timestamp (`align:start position:0%`), NOTE/STYLE blocks, and
 * `<v Speaker>` voice tags.
 */
export function parseCues(source: string): Cue[] {
  const cues: Cue[] = [];
  let current: Cue | null = null;
  let skipBlock = false;

  for (const raw of tidy(source).split("\n")) {
    const line = raw.trim();

    if (!line) {
      if (current) {
        cues.push(current);
        current = null;
      }
      skipBlock = false;
      continue;
    }
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(line)) {
      skipBlock = true;
      continue;
    }
    if (skipBlock) continue;

    if (line.includes("-->")) {
      const start = parseTimestamp(line.split("-->")[0]);
      if (start !== null) current = { start, text: "" };
      continue;
    }
    // An SRT sequence number on its own line, before we've seen a timing line.
    if (!current && /^\d+$/.test(line)) continue;

    if (current) {
      const clean = line.replace(/<[^>]+>/g, "").trim();
      if (clean) current.text = current.text ? `${current.text} ${clean}` : clean;
    }
  }
  if (current) cues.push(current);

  return cues.filter((c) => c.text);
}

/**
 * Transcript → chunks, grouped into windows of speech.
 *
 * A chunk closes when it has covered TRANSCRIPT_WINDOW_SECONDS or filled MAX_CHARS,
 * whichever comes first — a fast talker shouldn't produce a chunk twice the size of
 * everyone else's.
 *
 * `startSeconds` is the first cue in the window, which is what the citation links to.
 * Deliberately not the closest cue to the matched text: landing a few seconds early is
 * helpful, landing mid-sentence is not.
 */
export function chunkTranscript(source: string): Chunk[] {
  const cues = parseCues(source);
  if (cues.length === 0) return [];

  const chunks: Chunk[] = [];
  let start = cues[0].start;
  let buf = "";

  const flush = () => {
    if (!buf) return;
    chunks.push({
      ordinal: chunks.length,
      heading: null,
      content: buf,
      startSeconds: Math.floor(start),
      anchor: null,
    });
    buf = "";
  };

  for (const cue of cues) {
    const wouldOverrun = buf && (cue.start - start >= TRANSCRIPT_WINDOW_SECONDS || buf.length + cue.text.length + 1 > MAX_CHARS);
    if (wouldOverrun) {
      flush();
      start = cue.start;
    }
    buf = buf ? `${buf} ${cue.text}` : cue.text;
  }
  flush();

  return chunks;
}

/** `4530` → `1:15:30`, `882` → `14:42`. For citation labels. */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
