// npm run check:shared — pure, no env. "One house on two lots" (lib/kml/standard-markup/
// shared-houses.ts) against the real Clayfield job that raised it.
import assert from "node:assert/strict";
import fixture from "@/lib/kml/standard-markup/__fixtures__/clayfield-shared-houses.json";
import { ringAreaSqm } from "@/lib/kml/standard-markup/geometry";
import { findSharedHouses, mergedStreet, unionAdjacentRings } from "@/lib/kml/standard-markup/shared-houses";

const lots = fixture.lots;
const street = (id: string) => lots.find((l) => l.id === id)?.street;
const groups = findSharedHouses(lots, fixture.buildings).map((g) => g.map(street).sort());

// Exactly the three pairs Rhys named — and nothing else on the block: not the strata lots at
// 29 Barlow Street (one building, many titles, by definition), not a third lot a house
// overhangs by a metre or two.
assert.deepEqual(
  groups.map((g) => g.join(" + ")).sort(),
  [
    "18 Upper Lancaster Road + 20 Upper Lancaster Road",
    "22 Upper Lancaster Road + 24 Upper Lancaster Road",
    "26 Upper Lancaster Road + 26A Upper Lancaster Road",
  ]
);

// The merged outline is one ring whose area is the two lots added up.
for (const [a, b] of [["71RP33570", "72RP33570"], ["69RP33570", "70RP33570"], ["67RP33570", "68RP33570"]]) {
  const ra = lots.find((l) => l.id === a)!.ring;
  const rb = lots.find((l) => l.id === b)!.ring;
  const u = unionAdjacentRings(ra, rb);
  assert.ok(u, `${a} + ${b} should union`);
  const sum = ringAreaSqm(ra) + ringAreaSqm(rb);
  assert.ok(Math.abs(ringAreaSqm(u) - sum) < 0.5, `${a} + ${b}: ${ringAreaSqm(u)} vs ${sum}`);
}
// Lots that don't touch don't union.
assert.equal(unionAdjacentRings(lots.find((l) => l.id === "72RP33570")!.ring, lots.find((l) => l.id === "67RP33570")!.ring), null);

assert.equal(mergedStreet(["26 Upper Lancaster Road", "26A Upper Lancaster Road"]), "26 & 26A Upper Lancaster Road");
assert.equal(mergedStreet(["26A Upper Lancaster Road", "26 Upper Lancaster Road"]), "26 & 26A Upper Lancaster Road");
assert.equal(mergedStreet(["24 X Rd", "22 X Rd"]), "22 & 24 X Rd");
assert.equal(mergedStreet(["1 Smith St", "2 Jones Rd"]), "1 Smith St & 2 Jones Rd");
assert.equal(mergedStreet([null, "4 Smith St"]), "4 Smith St");

console.log("✓ shared houses: 3 pairs found at Clayfield, unions add up, nothing extra flagged");
