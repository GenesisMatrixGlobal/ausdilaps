// npm run check:spam — pure. Pins the enquiry-form junk filter (lib/spam.ts) against the real
// bot submissions it was written for, and against real enquiries it must never drop.
import assert from "node:assert/strict";
import { isJunkToken, looksLikeJunk } from "@/lib/spam";

// Straight out of the leads table, 9–11 Oct 2026.
const bot: [string, string][] = [
  ["fQSwaixgizuRlqYTYlEwnWFy", "aAyfymbolQOcoWoZfO"],
  ["iOLhPBAwLvNjhYXFIvBFR", "XjnDrIjnrBMyfHFTWYWJBqTb"],
  ["cjGxlFsyRsZYGcroazH", "vFiHPDeDHhoUCctK"],
  ["QJUbptNQbYykcmSOH", "kNoLpfLEbBRJSdNuZKM"],
  ["noTpEXLLcOYWkzZhA", "wbcslKeZnEzCHsJblGUvqtTf"],
  ["IiBfszRINgpFODrxrBz", "hVWcYLcRjomXYlSo"],
  ["QlUycRibTOUwtepEGyn", "hkXRzFXpINrrHVfaa"],
];
for (const [name, notes] of bot) assert.ok(looksLikeJunk({ name, notes }), `bot not caught: ${name}`);

// Real enquiries from the same table — single-word names, blank messages, short messages.
const real: [string, string][] = [
  ["Lynn", ""],
  ["Haneul", ""],
  ["Brittany", "test request"],
  ["Jennifer Dewar", "Arrange dilapidation inspection."],
  ["Trent", "Work order 39120 Pleaee supply builder and abn When you contact me"],
  ["Kirby Jordana", "I received a letter with QR code re Metis Group build on 33 Cross St."],
];
for (const [name, notes] of real) assert.ok(!looksLikeJunk({ name, notes }), `real enquiry dropped: ${name}`);

// Names that look odd but are real people's names.
for (const name of ["MacDonald", "VanDerWesthuizen", "McKenzieSmith", "DeLaCruz", "OConnor"]) {
  assert.ok(!isJunkToken(name), `real name flagged: ${name}`);
}

// A junk name alone is never enough: the message has to be junk too.
assert.ok(!looksLikeJunk({ name: "fQSwaixgizuRlqYTYlEwnWFy", notes: "" }), "junk name + blank message kept");
assert.ok(!looksLikeJunk({ name: "fQSwaixgizuRlqYTYlEwnWFy", notes: "Please call me" }), "junk name + real message kept");

console.log(`✓ spam filter: ${bot.length} bot posts caught, ${real.length} real enquiries kept`);
