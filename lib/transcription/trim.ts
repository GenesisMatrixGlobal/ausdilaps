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
  /^(sorry|oops|no,? sorry|scratch that|my mistake|please)[.!,]?$/i,
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
  // "please" carries nothing the report needs — "south wall here, please." (the team, 2026-09-18)
  [/[,\s]*\bplease\b[,]?/gi, ""],
  // "you know" — on the manager's filler list (2026-10-08). "Like" and "sort of" are NOT here:
  // "looks like a stepped crack" and "a sort of hairline crack" carry meaning a regex can't see.
  [/[,\s]*\byou know\b[,]?/gi, ""],
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
// "N and M" is garbled only as a hundred plus a remainder ("300 and 34", "300And34" — one number
// said as "three hundred and thirty-four"). "84 and 85" is two photos, and flagging it was noise:
// on a real 19-minute dictation (30 Danby St, 2026-10-08) 12 of 16 flags were clear numbers.
const GARBLED_NUMBER = /\b(\d*00\s*and\s*\d{1,2}|\d+[a-z]+\d+|hundred and \d+|(one|two|three|four|five|six|seven|eight|nine)\s+(hundred|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+\w+)\b/i;

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

/** A line that is talking about photo numbers — the only place a spoken number is converted. */
const PHOTO_CONTEXT = /\b(photos?|figures?|pictures?|number|no\.?|#)\b/i;

const ONES: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS: Record<string, number> = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const O = Object.keys(ONES).join("|");
const SPOKEN_HUNDREDS = new RegExp(
  `\\b(${O})[\\s-]+(?:(${Object.keys(TENS).join("|")})(?:[\\s-]+(${O}))?|(${Object.keys(TEENS).join("|")})|oh[\\s-]+(${O}))\\b`,
  "gi"
);

/**
 * "Photo one forty one, one forty two" → "Photo 141, 142". The usual way to say a three-digit
 * photo number, which Deepgram leaves as words; the manager's rule is digits (2026-10-08). Only
 * the hundreds-then-tens shape, and only on a line about photo numbers. Digit-by-digit ("one two
 * eight") and "hundred and" forms stay as heard and are flagged — those are the ambiguous ones.
 */
export function spokenPhotoNumbers(line: string): string {
  if (!PHOTO_CONTEXT.test(line)) return line;
  return line.replace(SPOKEN_HUNDREDS, (_m, h: string, tens?: string, unit?: string, teen?: string, oh?: string) => {
    const k = (w?: string) => (w ?? "").toLowerCase();
    const rest = tens ? TENS[k(tens)] + (unit ? ONES[k(unit)] : 0) : teen ? TEENS[k(teen)] : ONES[k(oh)];
    return String(ONES[k(h)] * 100 + rest);
  });
}

const TIMESTAMP = /^\d{2}:\d{2}:\d{2}$/;

export function trimLine(text: string): string {
  let t = text.trim();
  if (!t) return "";
  if (DROP_LINE.some((re) => re.test(t))) return "";
  for (const [re, to] of EDIT) t = t.replace(re, to);
  t = spokenPhotoNumbers(t);
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
