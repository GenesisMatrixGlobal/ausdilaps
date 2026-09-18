// "For typing": the transcript with everything the typing skill does not need taken out. Pure.
//
// The report team's own list (2026-09-18, via Rhys): the greeting, the "today I'm going to do
// the pre-inspection at …" intro (the address is in the header already), temperature, weather,
// the sign-off and any thank-you, the door-knock / external-only / work-order preamble, and the
// meta-commentary ("that is the only photo I could capture"); plus the fillers an inspector
// says between figures — leading "so" / "now", "just", "which is" as a connector — and
// "along with", which the house style never types and always reads as "and".
//
// DETERMINISTIC, not a model pass, on purpose: the same line always comes out the same way,
// it costs nothing, a rule that misfires is a one-line fix pinned in check:transcript, and the
// raw and cleaned transcripts stay one click away for anything it took out. It runs AFTER the
// mis-hearing clean-up (which needs every line intact for its timestamp invariant) and never
// touches the header. A line whose text is emptied loses its timestamp with it.

import { HEADER_LINE_COUNT, splitHeader } from "./format";

/** Whole lines that carry no figure content. Tested against the trimmed, cleaned text. */
const DROP_LINE: readonly RegExp[] = [
  /^(hi|hello|hey|good (morning|afternoon|evening))\b/i, // "Hi, this is Ram."
  /^this is [a-z' -]+[.!]?$/i,
  /\b(pre|post|print|pri)[- ]?inspection (at|of|for)\b/i, // "Today I'm going to do the pre-inspection at 13 …"
  /\btemperature\b/i,
  /\bthe weather\b/i,
  /\bthat('s| is) all( for (today|now))?\b/i,
  /^(thank you|thanks|cheers)\b/i,
  /\bdoor ?knock/i,
  /\bno ?one (is )?(responding|answering|home)\b/i,
  /\bno access (inside|to|into)\b/i,
  /\bas per the (work order|resident|client|instruction)/i,
  /\b(i'?m|i am|i will be|i'?ll be|i will|i'?ll) (just )?(going to |gonna )?(do|doing|be doing|start(ing)? with)( just)?( with)? the external\b/i,
  /\bonly (photo|shot|picture) i could (capture|take|get)\b/i,
  /\bfrom (a|the) safe distance\b/i,
  // a correction left standing on its own after the clean-up resolved the line it belonged to
  /^(sorry|oops|no,? sorry|scratch that|my mistake)[.!,]?$/i,
];

/** Phrases removed or replaced inside a line that otherwise stays. Order matters. */
const EDIT: readonly [RegExp, string][] = [
  // a thank-you tacked onto a real line: "…from the east yard, and thank you so much."
  [/[,.;]?\s*(and\s+)?(thank you|thanks)( so much| very much| a lot)?[.!]*\s*$/i, "."],
  [/[,.;]?\s*as per the work order\b[,.]?/gi, ""],
  // "along with" is never typed as-is
  [/\balong with\b/gi, "and"],
  // "which is" as a connector before a photo number: "the next photo, which is photo number 19, is …"
  [/,?\s*\bwhich is\s+(?=(the |a )?(photo|figure|picture|number|#)\b)/gi, ", "],
  // "just" as filler, wherever it lands
  [/\bjust\s+/gi, ""],
];

/** Leading fillers, peeled repeatedly: "So, now the next photo…" → "The next photo…". */
const LEADING_FILLER = /^(so|now|okay|ok|alright|right|um|uh|yeah|yes|sorry)\b[,.]?\s+/i;

/** Flags the clean-up pass appends — [CHECK: …] / [CHECK NUMBER: …]. Never stripped, and the
 *  UI counts them so the operator knows how many lines want a second look. */
export const CHECK_FLAG = /\[CHECK( NUMBER)?:[^\]]*\]/g;

/**
 * Safety net under the model's number flagging: a figure number that came through as digits
 * glued to a word ("300And34") or a spelt-out hundred ("Hundred And 20") is a transcription
 * error the typist has to resolve, and it must never pass unflagged even if the clean-up pass
 * missed it. Adds a flag only when the line has none.
 */
const GARBLED_NUMBER = /\b(\d+\s*and\s*\d+|\d+[a-z]+\d+|hundred and \d+|(one|two|three|four|five|six|seven|eight|nine)\s+(hundred|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+\w+)\b/i;

export function flagGarbledNumber(line: string): string {
  if (CHECK_FLAG.test(line)) {
    CHECK_FLAG.lastIndex = 0;
    return line;
  }
  CHECK_FLAG.lastIndex = 0;
  const m = GARBLED_NUMBER.exec(line);
  if (!m || !/\b(photo|figure|picture|number|no\.?|#)\b/i.test(line)) return line;
  return `${line.replace(/\s*$/, "")} [CHECK NUMBER: ${m[1].trim()}]`;
}

export function countFlags(text: string): number {
  const n = (text.match(CHECK_FLAG) || []).length;
  CHECK_FLAG.lastIndex = 0;
  return n;
}

const TIMESTAMP = /^\d{2}:\d{2}:\d{2}$/;

export function trimLine(text: string): string {
  let t = text.trim();
  if (!t) return "";
  if (DROP_LINE.some((re) => re.test(t))) return "";
  for (const [re, to] of EDIT) t = t.replace(re, to);
  for (let guard = 0; guard < 4 && LEADING_FILLER.test(t); guard++) t = t.replace(LEADING_FILLER, "");
  t = t
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/^[,.;\s]+/, "")
    .trim();
  if (!t || !/[a-z0-9]/i.test(t)) return "";
  t = t[0].toUpperCase() + t.slice(1);
  // A flag sits after the sentence's own full stop; don't add another after the bracket.
  if (!/[.!?\]]$/.test(t)) t += ".";
  return flagGarbledNumber(t);
}

/** The whole formatted transcript (header + timestamped lines) with the non-figure content
 *  removed. The header is kept verbatim; a dropped line takes its timestamp with it. */
export function trimForTyping(text: string): string {
  const { header, body } = splitHeader(text);
  const lines = body.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (TIMESTAMP.test(line.trim())) {
      const next = lines[i + 1] ?? "";
      if (TIMESTAMP.test(next.trim())) continue; // a stamp with no text under it
      const kept = trimLine(next);
      if (kept) out.push(line.trim(), kept);
      i++;
    } else {
      const kept = trimLine(line);
      if (kept) out.push(kept);
    }
  }
  const trimmed = out.join("\n");
  return header ? (trimmed ? `${header}\n${trimmed}` : header) : trimmed;
}

/** How many timestamped lines the trim removed — for the note under the toolbar. */
export function linesRemoved(before: string, after: string): number {
  const count = (t: string) => t.split("\n").slice(HEADER_LINE_COUNT).filter((l) => TIMESTAMP.test(l.trim())).length;
  return Math.max(0, count(before) - count(after));
}
