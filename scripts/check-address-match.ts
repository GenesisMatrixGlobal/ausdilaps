// Address-layer matching check. Pure: no env, no network.
//
//   npx tsx scripts/check-address-match.ts
//
// The matcher decides whether a state address-layer feature IS the address the operator typed,
// which is what lets the tools catch a geocoder that put No. 44 on No. 42's lot. Fixtures are
// real strings from the NSW, QLD and VIC layers. Exits non-zero on any failure.

import {
  findAddressFeature,
  houseNumberMatches,
  normaliseRoad,
  parseHouseNumber,
  stripUnit,
} from "@/lib/kml/standard-markup/parcels/address-match";

let failures = 0;
function fail(msg: string) {
  failures++;
  console.error(`✗ ${msg}`);
}
function eq<T>(actual: T, want: T, what: string) {
  if (JSON.stringify(actual) !== JSON.stringify(want)) fail(`${what}: got ${JSON.stringify(actual)}, want ${JSON.stringify(want)}`);
}

eq(normaliseRoad("Eastern Ave"), "EASTERN AVENUE", "Ave → AVENUE");
eq(normaliseRoad("St Georges Tce"), "STREET GEORGES TERRACE", "St expands (harmless — both sides expand the same way)");
eq(normaliseRoad("ALBANY CREEK RD"), "ALBANY CREEK ROAD", "Rd → ROAD");
eq(normaliseRoad("O'Connell St."), "O CONNELL STREET", "punctuation");

eq(parseHouseNumber("51-53 Eastern Ave"), { from: "51", to: "53" }, "range");
eq(parseHouseNumber("38A EASTERN AVENUE"), { from: "38A" }, "suffix");
eq(parseHouseNumber("LOT 5 SMITH RD"), null, "no number");
eq(stripUnit("Unit 1/48 Eastern Ave"), "48 Eastern Ave", "unit stripped");
eq(stripUnit("1/48 Eastern Ave"), "48 Eastern Ave", "slash unit stripped");
eq(stripUnit("48 Eastern Ave"), "48 Eastern Ave", "no unit");

eq(houseNumberMatches({ from: "44" }, { from: "44" }), true, "exact");
eq(houseNumberMatches({ from: "44" }, { from: "42" }), false, "different");
eq(houseNumberMatches({ from: "69" }, { from: "67", to: "77" }), true, "inside range, same parity");
eq(houseNumberMatches({ from: "68" }, { from: "67", to: "77" }), false, "inside range, wrong parity");
eq(houseNumberMatches({ from: "51", to: "53" }, { from: "51-53".split("-")[0], to: "53" }), true, "range vs range");
eq(houseNumberMatches({ from: "53" }, { from: "51", to: "53" }), true, "end of range");

// Real NSW property polygons around Eastern Ave (address minus number = rest).
const nsw = [
  { number: "42", rest: "EASTERN AVENUE DOVER HEIGHTS", point: "A" },
  { number: "44", rest: "EASTERN AVENUE DOVER HEIGHTS", point: "B" },
  { number: "44", rest: "OCEANVIEW AVENUE VAUCLUSE", point: "C" },
  { number: "67-77", rest: "OCEANVIEW AVENUE DOVER HEIGHTS", point: "D" },
];
eq(findAddressFeature(nsw, { street: "44 EASTERN AVE", suburb: "DOVER HEIGHTS" })?.point, "B", "44 Eastern finds its own polygon");
eq(findAddressFeature(nsw, { street: "Unit 6/44 Eastern Avenue", suburb: "Dover Heights" })?.point, "B", "unit + full type");
eq(findAddressFeature(nsw, { street: "44 Eastern Ave", suburb: "" })?.point, "B", "no suburb still picks by road");
eq(findAddressFeature(nsw, { street: "71 Oceanview Ave", suburb: "Dover Heights" })?.point, "D", "odd number inside a range property");
eq(findAddressFeature(nsw, { street: "46 EASTERN AVE", suburb: "DOVER HEIGHTS" }), null, "missing number → null");
eq(findAddressFeature(nsw, { street: "44 Eastern Avenue North", suburb: "Dover Heights" }), null, "different road → null");

// QLD points: street_full + locality.
const qld = [
  { number: "24", rest: "Albany Creek Road Aspley", point: "Q1" },
  { number: "28A", rest: "Albany Creek Road Aspley", point: "Q2" },
];
eq(findAddressFeature(qld, { street: "28a Albany Creek Rd", suburb: "Aspley" })?.point, "Q2", "QLD suffix, case-insensitive");
eq(findAddressFeature(qld, { street: "24 Albany Creek Road", suburb: "ASPLEY" })?.point, "Q1", "QLD exact");

// VIC: ezi_address remainder with postcode already stripped.
const vic = [{ number: "91A", rest: "KINGSWAY GLEN WAVERLEY", point: "V1" }];
eq(findAddressFeature(vic, { street: "91A Kingsway", suburb: "Glen Waverley" })?.point, "V1", "VIC no road type");

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("✓ address-layer matching behaves as expected");
