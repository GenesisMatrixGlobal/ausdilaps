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
import { countFlags, flagGarbledNumber, linesRemoved, trimForTyping, trimLine } from "@/lib/transcription/trim";

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

// ── "for typing": the report team's strip list, on lines out of real dictations ──
const DROPPED = [
  "Hi, this is Rayam.",
  "Hi. This is Ram.",
  "Today I'm going to do the pre-inspection at 11 Emerald Hood Street, Funville.",
  "Today I'm going to do the print inspection at 13 Emerald Hood Street, Fernville.",
  "The temperature is around 21 degrees Celsius.",
  "The weather is sunny.",
  "The temperature is around 21 degrees Celsius, the weather is sunny.",
  "Since there is no one responding to my door knock, so I'm going to do just the external inspection as per the work order.",
  "Now, similarly, there is no access inside the house, so I'm just going to do the external inspection as per the work order.",
  "So I will be just doing the external photos whichever I can from the safe distance as per the work order.",
  "So as per the resident requested, I'm going to do the external inspection first.",
  "That is the only photo I could capture.",
  "And that's all for today.",
  "Thank you.",
  "and that's all for today thank you",
];
for (const line of DROPPED) eq(trimLine(line), "", `dropped: ${line}`);

const KEPT: [string, string][] = [
  ["The first photo is the cover photo of the address.", "The first photo is the cover photo of the address."],
  ["So the next photo, which is photo number two, is the west wall of the house.", "The next photo, photo number two, is the west wall of the house."],
  ["So the next photo which is the photo number two is the general view of the west yard of the house.", "The next photo, the photo number two is the general view of the west yard of the house."],
  ["Now the next photo is again the west wall of the house.", "The next photo is again the west wall of the house."],
  ["Next photo is again the closer shot of the east wall of the house along with the boundary fence.", "Next photo is again the closer shot of the east wall of the house and the boundary fence."],
  ["And next photo is the overall view of the house from the East Yard, and thank you so much.", "And next photo is the overall view of the house from the East Yard."],
  ["Now the next couple of photos will be on the entrance hallway outside of the house.", "The next couple of photos will be on the entrance hallway outside of the house."],
  ["Minor damage in the flooring in hallway, just outside the pool room.", "Minor damage in the flooring in hallway, outside the pool room."],
  ["So, now the next photo photo number 12 is the retaining wall on the rear of the house.", "The next photo photo number 12 is the retaining wall on the rear of the house."],
  ["Next photo is the boundary fence on the west yacht", "Next photo is the boundary fence on the west yacht."],
];
for (const [inp, want] of KEPT) eq(trimLine(inp), want, `kept: ${inp}`);

// ── flags: corrections and garbled numbers are kept and marked, never cut ──
eq(trimLine("Sorry."), "", "a stranded 'Sorry.' goes");
eq(trimLine("Please."), "", "a stranded 'Please.' goes");
eq(trimLine("Sorry. West wall, south wall here, please."), "West wall, south wall here.", "'please' is ignored wherever it lands");
eq(trimLine("Please note the crack on the east wall."), "Note the crack on the east wall.", "leading 'please' goes too");
eq(trimLine("Next photo, please, is the ceiling."), "Next photo is the ceiling.", "mid-sentence 'please' goes with its commas");
eq(trimLine("Sorry, south wall of the house."), "South wall of the house.", "a leading 'sorry' is a filler");
eq(
  trimLine("The fine gap on the south wall of the house. [CHECK: west or south wall?]"),
  "The fine gap on the south wall of the house. [CHECK: west or south wall?]",
  "a model flag survives the trim untouched, no second full stop"
);
eq(flagGarbledNumber("Photo 300And34 is the north wall of the house."), "Photo 300And34 is the north wall of the house. [CHECK NUMBER: 300And34]", "digits glued to a word are flagged");
eq(flagGarbledNumber("Next photo, photo number Hundred And 20, is the ceiling."), "Next photo, photo number Hundred And 20, is the ceiling. [CHECK NUMBER: Hundred And 20]", "spelt-out hundred is flagged");
eq(flagGarbledNumber("Photo two thirty five is the kerb."), "Photo two thirty five is the kerb. [CHECK NUMBER: two thirty five]", "spelt-out digits are flagged");
eq(flagGarbledNumber("The next photo is photo number 19."), "The next photo is photo number 19.", "a plain number is not flagged");
eq(flagGarbledNumber("Photo 300And34 is the wall. [CHECK NUMBER: 300And34, likely 334]"), "Photo 300And34 is the wall. [CHECK NUMBER: 300And34, likely 334]", "an already-flagged line is left alone");
eq(flagGarbledNumber("The 2 and 3 storey buildings on the east side."), "The 2 and 3 storey buildings on the east side.", "digits joined by 'and' with no photo word are not a figure number");
eq(trimLine("So the next photo for number 56756 is the north wall of room 3."), "The next photo for number 56756 is the north wall of room 3.", "a long odd number with no garble pattern passes through (the model flags it)");
eq(countFlags("a [CHECK: x] b [CHECK NUMBER: 1, likely 2] c"), 2, "flags counted");

{
  const full = formatTranscript({
    name: "11 Emeraldwood st.mp3",
    utterances: [
      { start: 1, end: 2, text: "Hi, this is Rayam." },
      { start: 2, end: 8, text: "Today I'm going to do the pre-inspection at 11 Emerald Hood Street, Funville." },
      { start: 8, end: 13, text: "The temperature is around 21 degrees Celsius." },
      { start: 16, end: 19, text: "The first photo is the cover photo of the address." },
      { start: 29, end: 36, text: "So the next photo, which is photo number two, is the west wall of the house." },
      { start: 114, end: 118, text: "And next photo is the overall view of the house from the East Yard, and thank you so much." },
    ],
  });
  const typing = trimForTyping(full);
  eq(
    typing,
    [
      "Audio file",
      "11 Emeraldwood st.mp3",
      "Transcript",
      "00:00:16",
      "The first photo is the cover photo of the address.",
      "00:00:29",
      "The next photo, photo number two, is the west wall of the house.",
      "00:01:54",
      "And next photo is the overall view of the house from the East Yard.",
    ].join("\n"),
    "for-typing keeps the header, drops the preamble with its timestamps, edits the rest"
  );
  eq(linesRemoved(full, typing), 3, "three lines removed");
  eq(trimForTyping(typing), typing, "trimming twice changes nothing");
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
