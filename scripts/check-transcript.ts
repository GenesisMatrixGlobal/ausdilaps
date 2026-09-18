// Transcription Buddy layout check. Pure: no env, no network.
//
//   npm run check:transcript
//
// The transcript layout is a CONTRACT with the report team's typing skill (type-pre-report),
// which reads Word Transcribe's output today: "Audio file" / the file name / "Transcript" /
// alternating hh:mm:ss and text lines, files separated by blank lines. This pins that layout
// so a tidy-up of format.ts cannot silently break the skill, and pins the file-name keyterm
// parsing that hands Deepgram the street name. Exits non-zero on any failure.

import { formatBatch, formatTranscript, splitHeader, timestamp, timestampLines } from "@/lib/transcription/format";
import { DICTATION_KEYTERMS, STAFF_NAMES, keytermsFor, keytermsForFile } from "@/lib/transcription/keyterms";

let failures = 0;
function fail(msg: string) {
  failures++;
  console.error(`✗ ${msg}`);
}
function eq<T>(actual: T, expected: T, what: string) {
  if (actual !== expected) fail(`${what}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
}

// ── timestamps ──────────────────────────────────────────────────────────
eq(timestamp(0), "00:00:00", "t=0");
eq(timestamp(1.94), "00:00:01", "floors, never rounds up (Word prints whole seconds)");
eq(timestamp(59.999), "00:00:59", "just under a minute");
eq(timestamp(60), "00:01:00", "one minute");
eq(timestamp(3661), "01:01:01", "over an hour");

// ── one file, the Word layout ───────────────────────────────────────────
// Utterance shapes as Deepgram returns them for the 11 Emeraldwood recording (redacted).
const emeraldwood = {
  name: "11 Emeraldwood st.mp3",
  utterances: [
    { start: 1.12, end: 2.0, text: "Hi, this is Ram." },
    { start: 2.4, end: 7.9, text: "Today I'm going to do the pre-inspection at 11 Emeraldwood Street, Fernvale." },
    { start: 8.3, end: 12.1, text: "  " }, // Deepgram can emit an empty utterance; it must not become a bare timestamp
    { start: 13.0, end: 15.2, text: "The weather is sunny." },
  ],
};
eq(
  formatTranscript(emeraldwood),
  [
    "Audio file",
    "11 Emeraldwood st.mp3",
    "Transcript",
    "00:00:01",
    "Hi, this is Ram.",
    "00:00:02",
    "Today I'm going to do the pre-inspection at 11 Emeraldwood Street, Fernvale.",
    "00:00:13",
    "The weather is sunny.",
  ].join("\n"),
  "single file in the Word layout, empty utterance skipped"
);

// ── the batch separator ─────────────────────────────────────────────────
const sunnywood = {
  name: "3 Sunnywood st.mp3",
  utterances: [{ start: 0.5, end: 1.4, text: "Hi, this is Ram." }],
};
const batch = formatBatch([formatTranscript(emeraldwood), formatTranscript(sunnywood)]);
eq(batch.split("\n\n\n").length, 2, "two files separated by two blank lines");
eq(batch.startsWith("Audio file\n11 Emeraldwood st.mp3"), true, "first file first");
eq(batch.endsWith("Audio file\n3 Sunnywood st.mp3\nTranscript\n00:00:00\nHi, this is Ram."), true, "second file last");
eq(formatBatch(["", "  ", formatTranscript(sunnywood)]), formatTranscript(sunnywood), "blank blocks dropped");

// ── the clean-up invariant ──────────────────────────────────────────────
eq(timestampLines(formatTranscript(emeraldwood)).join(","), "00:00:01,00:00:02,00:00:13", "timestamp lines extracted in order");
eq(timestampLines("00:00:01\nnot 00:00:02 a timestamp\n00:00:03").join(","), "00:00:01,00:00:03", "only whole-line timestamps count");

// ── header / body split (what the clean-up pass is and is not shown) ────
{
  const full = formatTranscript(emeraldwood);
  const { header, body } = splitHeader(full);
  eq(header, "Audio file\n11 Emeraldwood st.mp3\nTranscript", "header is exactly the three fixed lines");
  eq(body.startsWith("00:00:01\nHi, this is Ram."), true, "body starts at the first timestamp");
  eq(`${header}\n${body}`, full, "header + body round-trips");
  eq(splitHeader("00:00:01\nno header here").header, "", "text without a header has an empty header");
}

// ── file-name keyterms ──────────────────────────────────────────────────
eq(keytermsFor("11 Emeraldwood st.mp3").join("|"), "Emeraldwood Street", "house number dropped, st expanded");
eq(keytermsFor("13 Sunnywood st 2.mp3").join("|"), "Sunnywood Street", "part number dropped");
eq(keytermsFor("13 Sunnywood st 1.MP3").join("|"), "Sunnywood Street", "upper-case extension");
eq(keytermsFor("30 Bells Line of Road, North Richmond.m4a").join("|"), "Bells Line Of Road North Richmond", "multi-word street with a comma");
eq(keytermsFor("1-48 Connells Point Rd.mp3").join("|"), "Connells Point Road", "range number dropped, rd expanded");
eq(keytermsFor("recording_042.wav").join("|"), "Recording", "an ordinary file name still yields something harmless");
eq(keytermsFor("123.mp3").length, 0, "a bare number yields nothing");
eq(keytermsFor(".mp3").length, 0, "no stem yields nothing");

const full = keytermsForFile("11 Emeraldwood st.mp3");
eq(full[0], "Emeraldwood Street", "the file's own street comes first");
// ⚠️ Was `DICTATION_KEYTERMS.length + 1`, which quietly asserted the list is the file's street
// plus the trade vocabulary and nothing else. Staff NAMES joined it on 2026-09-18 after the first
// live run transcribed "This is Rhys Morgan" as "This is Reese Morgan" — so the composition is
// spelled out here rather than encoded as a magic +1.
eq(
  full.length,
  1 + STAFF_NAMES.length + DICTATION_KEYTERMS.length,
  "street, then names, then vocabulary — nothing duplicated"
);
// The opening sentence of every dictation says a name, so one has to be in the list.
eq(full.includes("Rhys Morgan"), true, "staff names are prompted for");
eq(new Set(full).size, full.length, "no duplicate keyterms");
// Deepgram caps the list at 500 tokens; ~1.5 tokens a word is a safe planning figure.
const words = full.join(" ").split(/\s+/).length;
if (words * 1.5 > 500) fail(`keyterm list too long: ~${Math.round(words * 1.5)} tokens of a 500 cap`);

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("✓ transcript layout and keyterms hold");
