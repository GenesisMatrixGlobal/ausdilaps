// npm run check:cbd — pure. Which centre a job's distance is quoted from (lib/maps/cbds.ts).
import assert from "node:assert/strict";
import { haversineKm, nearestCbd } from "@/lib/maps/cbds";

const near = (lat: number, lng: number) => nearestCbd({ lat, lng }).cbd.name;
assert.equal(near(-32.7316, 151.5525), "Newcastle"); // Maitland
assert.equal(near(-27.6144, 152.7606), "Brisbane"); // Ipswich
assert.equal(near(-38.1499, 144.3617), "Geelong");
assert.equal(near(-33.4193, 149.5775), "Sydney"); // Bathurst
assert.equal(near(-33.5803, 150.719), "Sydney"); // North Richmond
assert.equal(near(-27.3605, 153.0215), "Brisbane"); // Aspley
assert.equal(near(-37.844, 144.883), "Melbourne"); // Newport
assert.equal(near(-26.3947, 153.0922), "Sunshine Coast"); // Noosa
// Sydney GPO to Melbourne GPO is ~714 km as the crow flies.
assert.ok(Math.abs(haversineKm({ lat: -33.8688, lng: 151.2093 }, { lat: -37.8136, lng: 144.9631 }) - 714) < 5);
console.log("✓ nearest CBD: 8 towns land on the right centre");
