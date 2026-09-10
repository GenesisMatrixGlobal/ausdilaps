// Bulk Property Sizing — address parser check. Pure: no env, no network, no database.
//
//   npx tsx scripts/check-property-parse.ts
//
// The text tab is fed straight from Excel, so every fixture here is a ROW as Excel would
// paste it: tab-separated cells, or runs of spaces from a formula-built sheet. The first
// block is the real Vaucluse / Dover Heights job that exposed two bugs at once — the street
// number being taken as the row's ref, and a two-word suburb being split on its last word.
// Exits non-zero on any mismatch, so it can gate a commit.

import { parseAddressBlock, houseNumber } from "@/lib/property-sizing/parse";
import { houseNumberMismatch } from "@/lib/property-sizing";

interface Expected {
  id?: string;
  unit?: string;
  street: string;
  suburb: string;
  state?: string;
  postcode?: string;
}

const CASES: [string, Expected][] = [
  // Excel → tabs between cells.
  ["11\tCRAIG AVE\tVAUCLUSE NSW 2030", { street: "11 CRAIG AVE", suburb: "VAUCLUSE", state: "NSW", postcode: "2030" }],
  ["42\tEASTERN AVE\tDOVER HEIGHTS NSW 2030", { street: "42 EASTERN AVE", suburb: "DOVER HEIGHTS", state: "NSW", postcode: "2030" }],
  ["51-53\tEASTERN AVE\tDOVER HEIGHTS NSW 2030", { street: "51-53 EASTERN AVE", suburb: "DOVER HEIGHTS", state: "NSW", postcode: "2030" }],
  ["U 1\t48\tEASTERN AVE\tDOVER HEIGHTS NSW 2030", { unit: "1", street: "48 EASTERN AVE", suburb: "DOVER HEIGHTS", state: "NSW", postcode: "2030" }],
  ["42\tEASTERN AVE\tDOVER HEIGHTS\tNSW\t2030", { street: "42 EASTERN AVE", suburb: "DOVER HEIGHTS", state: "NSW", postcode: "2030" }],
  // Formula-built sheet → double spaces where the tabs were.
  ["11  CRAIG AVE  VAUCLUSE NSW 2030", { street: "11 CRAIG AVE", suburb: "VAUCLUSE", state: "NSW", postcode: "2030" }],
  ["U 6  48  EASTERN AVE  DOVER HEIGHTS NSW 2030", { unit: "6", street: "48 EASTERN AVE", suburb: "DOVER HEIGHTS", state: "NSW", postcode: "2030" }],
  // A genuine ref column stays a ref — the address after it has its own number.
  ["A17\t8 Ironwood Ct, Mountain Creek QLD 4557", { id: "A17", street: "8 Ironwood Ct", suburb: "Mountain Creek", state: "QLD", postcode: "4557" }],
  ["3\t44 Smith St\tSuburbia NSW 2000", { id: "3", street: "44 Smith St", suburb: "Suburbia", state: "NSW", postcode: "2000" }],
  // Single-line, no comma: the street TYPE finds the suburb boundary.
  ["42 Eastern Ave Dover Heights NSW 2030", { street: "42 Eastern Ave", suburb: "Dover Heights", state: "NSW", postcode: "2030" }],
  ["12 St Georges Tce Perth WA 6000", { street: "12 St Georges Tce", suburb: "Perth", state: "WA", postcode: "6000" }],
  ["10 Station St Park Ridge QLD 4125", { street: "10 Station St", suburb: "Park Ridge", state: "QLD", postcode: "4125" }],
  ["5 Wattle Crescent Mount Waverley VIC 3149", { street: "5 Wattle Crescent", suburb: "Mount Waverley", state: "VIC", postcode: "3149" }],
  ["1/48 Eastern Ave Dover Heights NSW 2030", { unit: "1", street: "48 Eastern Ave", suburb: "Dover Heights", state: "NSW", postcode: "2030" }],
  // Comma form — unchanged behaviour.
  ["8 Ironwood Ct, Mountain Creek QLD 4557", { street: "8 Ironwood Ct", suburb: "Mountain Creek", state: "QLD", postcode: "4557" }],
  ["Unit 103/8 Elizabeth St, Brisbane City QLD 4000", { unit: "103", street: "8 Elizabeth St", suburb: "Brisbane City", state: "QLD", postcode: "4000" }],
  // No street type at all — falls back to the last word.
  ["7 The Corso Manly NSW 2095", { street: "7 The Corso", suburb: "Manly", state: "NSW", postcode: "2095" }],
];

const MISMATCH_CASES: [string, string | null, boolean][] = [
  ["42 Eastern Ave", "42 Eastern Ave, Dover Heights NSW 2030, Australia", false],
  ["42 Eastern Ave", "41 Eastern Ave, Dover Heights NSW 2030, Australia", true],
  ["51-53 Eastern Ave", "51 Eastern Ave, Dover Heights NSW 2030, Australia", false],
  ["51-53 Eastern Ave", "53 Eastern Ave, Dover Heights NSW 2030, Australia", false],
  ["51-53 Eastern Ave", "55 Eastern Ave, Dover Heights NSW 2030, Australia", true],
  ["48 Eastern Ave", "1/48 Eastern Ave, Dover Heights NSW 2030, Australia", false],
  ["48 Eastern Ave", "Unit 6, 48 Eastern Ave, Dover Heights NSW 2030, Australia", false],
  ["12A Smith St", "12a Smith St, Somewhere QLD 4000", false],
  ["8 IRONWOOD CT", "8 IRONWOOD CT, MOUNTAIN CREEK", false],
  ["8 Ironwood Ct", "Eastern Ave, Dover Heights NSW 2030, Australia", false], // nothing to compare
  ["8 Ironwood Ct", null, false],
  ["LOT 5 Smith Rd", "7 Smith Rd, Somewhere QLD 4000", false], // no input number
];

let failures = 0;
function fail(msg: string) {
  failures++;
  console.error(`✗ ${msg}`);
}

for (const [line, want] of CASES) {
  const [got] = parseAddressBlock(line);
  if (!got) {
    fail(`${JSON.stringify(line)} → parsed to nothing`);
    continue;
  }
  const actual: Expected = { id: got.id, unit: got.unit, street: got.street, suburb: got.suburb, state: got.state, postcode: got.postcode };
  for (const key of Object.keys({ ...want, ...actual }) as (keyof Expected)[]) {
    if ((actual[key] ?? undefined) !== (want[key] ?? undefined)) {
      fail(`${JSON.stringify(line)} → ${key}: got ${JSON.stringify(actual[key])}, want ${JSON.stringify(want[key])}`);
    }
  }
}

// A block keeps every row, in order, with the blank lines dropped.
const block = CASES.map(([l]) => l).join("\r\n") + "\n\n";
if (parseAddressBlock(block).length !== CASES.length) fail(`block parse dropped rows: ${parseAddressBlock(block).length} of ${CASES.length}`);

for (const [street, matched, expectMismatch] of MISMATCH_CASES) {
  const got = houseNumberMismatch(street, matched) != null;
  if (got !== expectMismatch) {
    fail(`mismatch(${JSON.stringify(street)}, ${JSON.stringify(matched)}) → ${got}, want ${expectMismatch}`);
  }
}

if (JSON.stringify(houseNumber("51-53 Eastern Ave")) !== JSON.stringify({ from: "51", to: "53" })) fail("houseNumber range");
if (houseNumber("Eastern Ave") !== null) fail("houseNumber with no number should be null");

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log(`✓ ${CASES.length} address rows + ${MISMATCH_CASES.length} number-mismatch cases parse as expected`);
