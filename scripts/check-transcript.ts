// Transcription Buddy layout check. Pure: no env, no network.
//
//   npm run check:transcript
//
// The transcript layout is a CONTRACT with the report team's typing skill (type-pre-report),
// which reads Word Transcribe's output today: "Audio file" / the file name / "Transcript" /
// alternating hh:mm:ss and text lines, files separated by blank lines. This pins that layout
// so a tidy-up of format.ts cannot silently break the skill, and pins the file-name keyterm
// parsing that hands Deepgram the street name. Exits non-zero on any failure.

import { chunkBody, formatBatch, formatTranscript, splitHeader, timestamp, timestampLines } from "@/lib/transcription/format";
import { DICTATION_KEYTERMS, STAFF_NAMES, keytermsFor, keytermsForFile } from "@/lib/transcription/keyterms";
import { countFlags, flagGarbledNumber, linesRemoved, trimForTyping, trimLine } from "@/lib/transcription/trim";
import { extractBoxLinks, parseBoxLink } from "@/lib/transcription/box-link";
import { addDays, displayDate, isAtOrAfter, isIsoDate, matchesDay, matchesMonth, matchesYear, sydneyNow, sydneyYesterday } from "@/lib/transcription/nightly/dates";
import { folderInitials, initialsOf, matchInspector } from "@/lib/transcription/nightly/initials";
import { buildReport, renderDailyReport, renderMissingNotice } from "@/lib/transcription/nightly/report";

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

// ── chunking for the clean-up pass ─────────────────────────────────────
{
  const pairs = Array.from({ length: 7 }, (_, i) => `${timestamp(i * 10)}\nLine ${i}.`).join("\n");
  const chunks = chunkBody(pairs, 3);
  eq(chunks.length, 3, "seven pairs at three a chunk → three chunks");
  eq(chunks.join("\n"), pairs, "joining the chunks gives the body back exactly");
  eq(chunks.every((c) => /^\d{2}:\d{2}:\d{2}\n/.test(c)), true, "every chunk opens with a timestamp");
  eq(chunks.every((c) => !/\d{2}:\d{2}:\d{2}$/.test(c)), true, "no chunk ends on a bare timestamp");
  eq(chunkBody(pairs, 100).length, 1, "a short body is one chunk");
  eq(chunkBody("", 100).join(""), "", "an empty body is harmless");
}

// ── Box links ───────────────────────────────────────────────────────────
eq(JSON.stringify(parseBoxLink("https://ausdilaps.app.box.com/file/1234567890")), JSON.stringify({ kind: "file", fileId: "1234567890" }), "plain file link");
eq(JSON.stringify(parseBoxLink("https://ausdilaps.app.box.com/folder/99/file/1234567890?x=1")), JSON.stringify({ kind: "file", fileId: "1234567890" }), "file link inside a folder path is the FILE");
eq(JSON.stringify(parseBoxLink("https://ausdilaps.app.box.com/folder/285580919679")), JSON.stringify({ kind: "folder", folderId: "285580919679" }), "folder link");
eq(JSON.stringify(parseBoxLink("https://ausdilaps.app.box.com/s/abcDEF123xyz?sb=1")), JSON.stringify({ kind: "shared", url: "https://ausdilaps.app.box.com/s/abcDEF123xyz" }), "shared link, query dropped");
eq(parseBoxLink("https://example.com/file/123"), null, "not Box at all");
eq(
  extractBoxLinks("https://ausdilaps.app.box.com/file/1\nhttps://ausdilaps.app.box.com/folder/2, https://ausdilaps.app.box.com/file/1.").join(" "),
  "https://ausdilaps.app.box.com/file/1 https://ausdilaps.app.box.com/folder/2",
  "links pulled out of a pasted block, punctuation trimmed, duplicates dropped"
);
eq(extractBoxLinks("nothing here").length, 0, "no links → empty");

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

// ── nightly crawl: Sydney dates across the DST change ───────────────────
// Vercel Cron is UTC; the crawl is 4am SYDNEY. NSW moved to AEDT at 2am on Sun 4 Oct 2026.
eq(sydneyNow(new Date("2026-09-22T18:00:00Z")).hour, 4, "AEST: 18:00 UTC is 4am Sydney");
eq(sydneyNow(new Date("2026-09-22T17:00:00Z")).hour, 3, "AEST: 17:00 UTC is still 3am — that tick does nothing");
eq(sydneyNow(new Date("2026-10-05T17:00:00Z")).hour, 4, "AEDT: 17:00 UTC is 4am Sydney");
eq(sydneyYesterday(new Date("2026-09-22T18:00:00Z")), "2026-09-22", "4am on the 23rd works on the 22nd");
eq(sydneyYesterday(new Date("2026-10-04T17:10:00Z")), "2026-10-04", "4am on the 5th (AEDT) works on the 4th");
eq(addDays("2026-02-28", 1), "2026-03-01", "addDays crosses a month");
eq(addDays("2026-01-01", -1), "2025-12-31", "addDays crosses a year");
eq(isIsoDate("2026-02-30"), false, "not a real date");
eq(isAtOrAfter(new Date("2026-09-22T20:30:00Z"), "2026-09-23", 6, 30), true, "6:30am AEST is the report deadline");
eq(isAtOrAfter(new Date("2026-09-22T20:29:00Z"), "2026-09-23", 6, 30), false, "6:29am is not");
eq(displayDate("2026-09-22"), "Tue 22 Sep 2026", "display date");

// ── nightly crawl: finding year / month / day by name ───────────────────
eq(matchesYear("2026", 2026), true, "year");
eq(matchesYear("2025", 2026), false, "wrong year");
for (const n of ["09", "9", "Sep", "Sept", "September", "09 September", "2026-09", "9. September 2026"]) eq(matchesMonth(n, 2026, 9), true, `month "${n}"`);
for (const n of ["10", "October", "2026-10", "09 October", "2025-09"]) eq(matchesMonth(n, 2026, 9), false, `not September: "${n}"`);
for (const n of ["220926", "22092026", "20260922", "22", "22nd", "Tue 22", "2026-09-22", "22-09-2026", "22.09.26", "22 September"]) eq(matchesDay(n, "2026-09-22"), true, `day "${n}"`);
for (const n of ["230926", "220925", "221026", "23", "2026-09-23", "22-10-2026", "2026-10-22", "22 October", "Tue 2"]) eq(matchesDay(n, "2026-09-22"), false, `not the 22nd: "${n}"`);
eq(matchesDay("2026-09-02", "2026-02-09"), false, "ISO order is never read as day-month");
// The real tree, 2026-09-23: 2026 / 09. September / 220926.
eq(matchesMonth("09. September", 2026, 9), true, "real month folder");
eq(matchesMonth("08. August", 2026, 9), false, "real month folder, wrong month");
eq(folderInitials("RG - 37472-00039595-01 - Pre-Con - Standard - 27 Beenwerrin Crescent CAPALABA"), "RG", "a real job folder's initials");
eq(folderInitials("MW - ENG - REPORT AMENDMENT - NOOSAVILLE"), "MW", "a job folder with no job number");

// ── nightly crawl: inspector initials ───────────────────────────────────
eq(initialsOf("Martin (Jie) Weng"), "MW", "bracketed nickname dropped");
eq(initialsOf("Michael Yousry Aziz Metry"), "MM", "first and LAST word");
eq(initialsOf("Linda (Lai) Yee Win"), "LW", "nickname plus a middle name");
for (const n of ["MW", "mw", "M.W.", "M W", "MW - Martin"]) eq(folderInitials(n), "MW", `folder "${n}"`);
const staff = [
  { name: "Martin (Jie) Weng", email: "martin@example.com" },
  { name: "George Agapiadis", email: "george@example.com" },
  { name: "Ram Ghalley", email: null },
];
eq(matchInspector("MW", staff).kind, "match", "unique initials match");
eq(matchInspector("George Agapiadis", staff).kind, "match", "a folder with the full name matches");
eq(matchInspector("ZZ", staff).kind, "unknown", "unknown initials");
eq(matchInspector("MW", [...staff, { name: "Madison Wyre", email: "m@example.com" }]).kind, "ambiguous", "two current MWs are ambiguous — never emailed");

// ── nightly crawl: the morning report ───────────────────────────────────
const report = buildReport({
  date: "2026-09-22",
  dayFolderId: "1",
  dayFolderPath: "2026 / 09 / 22",
  folders: [
    { box_folder_id: "a", folder_name: "MW", initials: "MW", match_kind: "match", staff_name: "Martin (Jie) Weng", staff_email: "martin@example.com" },
    { box_folder_id: "b", folder_name: "GA - 1 - Pre-Con - 5 Norman St", initials: "GA", match_kind: "match", staff_name: "George Agapiadis", staff_email: "george@example.com", notes_files: ["5 norman st notes.docx"] },
    { box_folder_id: "d", folder_name: "GA - 2 - Pre-Con - 9 Norman St", initials: "GA", match_kind: "match", staff_name: "George Agapiadis", staff_email: "george@example.com" },
    { box_folder_id: "c", folder_name: "ZZ", initials: "ZZ", match_kind: "unknown", staff_name: null, staff_email: null },
  ],
  files: [
    { box_file_id: "f2", inspector_folder_id: "a", name: "12 Smith St Part 10.mp3", status: "done", attempts: 1, error: null, flags: 0, duration_seconds: 60, txt_box_file_id: "t", txt_error: null },
    { box_file_id: "f1", inspector_folder_id: "a", name: "12 Smith St Part 2.mp3", status: "done", attempts: 1, error: null, flags: 2, duration_seconds: 600, txt_box_file_id: "t", txt_error: null },
    { box_file_id: "f3", inspector_folder_id: "a", name: "13 Smith St.mp3", status: "failed", attempts: 3, error: "Deepgram API 400", flags: null, duration_seconds: null, txt_box_file_id: null, txt_error: null },
  ],
  live: false,
  budgetExhausted: false,
});
eq(report.totals.recordings, 3, "report counts every recording");
eq(report.totals.transcribed, 2, "and the transcribed ones");
eq(report.totals.failed, 1, "and the failures");
eq(report.totals.flags, 2, "and the [CHECK] lines");
eq(report.inspectors.find((i) => i.folderName === "MW")!.files[0].name, "12 Smith St Part 2.mp3", "parts in NATURAL order — Part 2 before Part 10");
eq(report.inspectors.filter((i) => i.missing).length, 3, "three job folders with no recording");
eq(report.notices.length, 1, "ONE notice per inspector, not one per job");
eq(report.notices[0].folders.length, 2, "listing both of George's jobs");
eq(report.inspectors.find((i) => i.folderId === "b")!.notes.join(), "5 norman st notes.docx", "written notes are carried to the report");
eq(report.notices[0].email, "george@example.com", "notice goes to George");
eq(report.unmatchedMissing.join(), "ZZ", "the unknown folder is reported, not emailed");
const email = renderDailyReport(report, "https://example.com/tool");
eq(email.subject, "Dictations for Tue 22 Sep 2026: 2 transcribed, 3 missing, 1 failed", "report subject");
eq(email.html.includes("written notes: 5 norman st notes.docx"), true, "the report shows a folder's written notes");
eq(email.html.includes("Would have emailed"), true, "shadow mode says who WOULD have been emailed");
eq(renderMissingNotice(report.notices[0], "2026-09-22").html.includes("Hi George,"), true, "notice greets by first name");
eq(renderMissingNotice(report.notices[0], "2026-09-22").subject, "2 jobs with no recording for Tue 22 Sep 2026", "one email names how many jobs");
eq(renderDailyReport({ ...report, inspectors: [{ ...report.inspectors[0], folderName: "<b>x</b>" }] }, "u").html.includes("<b>x</b>"), false, "folder names are escaped");

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("✓ transcript layout, keyterms and the nightly crawl hold");
