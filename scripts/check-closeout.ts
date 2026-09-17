/**
 * Regression suite for the Closeout Markup's grouping and colour rules.
 *
 * Pure — no env, no network, no Salesforce. The fixture is the REAL work order list from
 * `PRE OPT-34851 King Georges Road Stage 2A` with record Ids replaced, because every rule in
 * group.ts was derived from what that job actually contains: unit-numbered streets, tenancy
 * names, a stray induction booking and a building that is part done.
 *
 *   npm run check:closeout
 */
import { readFileSync } from "node:fs";
import {
  cleanStreet,
  colorForProperty,
  colorForWorkOrder,
  groupWorkOrders,
  isCouncilAsset,
  isInspection,
  looksLikeAddress,
} from "../lib/closeout-markup/group";
import type { WorkOrderRow } from "../lib/closeout-markup/types";

const fixture = JSON.parse(
  readFileSync(new URL("../lib/closeout-markup/__fixtures__/work-orders.json", import.meta.url), "utf8")
) as { rows: WorkOrderRow[] };

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`);
  }
}

console.log("\ncleanStreet — a work order is raised per TENANCY, so the tenancy has to come off");
check("unit, comma, building", cleanStreet("101 , 9 Derwent Street"), "9 Derwent Street");
check("lettered unit", cleanStreet("G01 , 9 Derwent Street"), "9 Derwent Street");
check("unit with letter", cleanStreet("1 , 1A Rickard Road"), "1A Rickard Road");
check("no space before comma", cleanStreet("10,  803-815 King Georges Road"), "803-815 King Georges Road");
check("named tenancy", cleanStreet("Commercial 1, 4-8 Allen Street"), "4-8 Allen Street");
check("business name, comma", cleanStreet("McDonald's, 799 King Georges Road"), "799 King Georges Road");
check("business name, dash", cleanStreet("Lloyd's IGA - 59 Connells Point Road"), "59 Connells Point Road");
check("business name, letter suffix", cleanStreet("Kings Head Tavern - 801a King Georges Road"), "801a King Georges Road");
check("floor prefix", cleanStreet("Ground Floor  803-815 King Georges Road"), "803-815 King Georges Road");
check("floor prefix behind a tenancy", cleanStreet("Shop 2/ Unit 25, Ground Floor 803-815 King Georges Road"), "803-815 King Georges Road");
check("two tenancy segments", cleanStreet("AU Post, GF, 52a Connells Point Road"), "52a Connells Point Road");
check("trailing parenthetical", cleanStreet("9 Derwent Street (Basement)"), "9 Derwent Street");
check("range spacing normalised", cleanStreet("824 -828 King Georges Road"), "824-828 King Georges Road");
check("plain address untouched", cleanStreet("799 King Georges Road"), "799 King Georges Road");
check("non-address left alone", cleanStreet("Induction"), "Induction");

// ⚠️ A slash means a unit and the address sits on EITHER side of it. Getting this backwards
// reduced three tenancies of 48-50 Connells Point Road to the streets "1", "2" and "3", which
// then read as three different addresses and lost the building off the drawing.
check("unit BEFORE the address", cleanStreet("South Hurstville Newsagency, 1/48-50 Connells Point Road"), "48-50 Connells Point Road");
check("tenancy AFTER the address", cleanStreet("9 Derwent Street / Suite 1, 51 Connells Point"), "9 Derwent Street");
// ⚠️ The business-name rule only fires when a NUMBER follows the dash, or a street whose own
// name contains one would lose half of itself.
check("dash inside a street name", cleanStreet("59 Bells Line of Road"), "59 Bells Line of Road");

console.log("\nlooksLikeAddress — work orders get raised for things that are not properties");
check("an address", looksLikeAddress("9 Derwent Street"), true);
check("an induction booking", looksLikeAddress("Induction"), false);
check("an admin task", looksLikeAddress("Access Letters"), false);
check("a unit-keyword address", looksLikeAddress("Unit 5 King Georges Road"), true);

console.log("\ncolorForWorkOrder — keyed on StatusCategory, so an inactive Status value still lands right");
check("Completed", colorForWorkOrder({ statusCategory: "Completed" }), "green");
check("Access Failed", colorForWorkOrder({ statusCategory: "CannotComplete" }), "red");
check("Canceled", colorForWorkOrder({ statusCategory: "Canceled" }), "red");
check("Dispatched", colorForWorkOrder({ statusCategory: "None" }), "orange");
check("In Progress", colorForWorkOrder({ statusCategory: "InProgress" }), "orange");
check("no category at all", colorForWorkOrder({ statusCategory: null }), "orange");

console.log("\ncolorForProperty — a part-done building must not read as done or as failed");
check("all done", colorForProperty({ green: 12, red: 0, orange: 0 }), "green");
check("all failed", colorForProperty({ green: 0, red: 4, orange: 0 }), "red");
check("all pending", colorForProperty({ green: 0, red: 0, orange: 3 }), "orange");
check("8 done, 19 failed", colorForProperty({ green: 8, red: 19, orange: 0 }), "partial");
check("mostly done, one pending", colorForProperty({ green: 30, red: 0, orange: 1 }), "partial");
check("empty", colorForProperty({ green: 0, red: 0, orange: 0 }), "orange");

console.log("\nisInspection — matched on WorkType, never on the address text");
check("a residential unit", isInspection({ workType: "Res Unit" }), true);
check("a council asset", isInspection({ workType: "Ext/CA GPS" }), true);
check("common areas", isInspection({ workType: "Common Areas" }), true);
check("a billing line", isInspection({ workType: "Billing Item" }), false);
check("training", isInspection({ workType: "Training (Auto)" }), false);
check("no work type at all", isInspection({ workType: null }), true);

console.log("\nisCouncilAsset — an external asset WITHOUT an exact address");
const ext = (street: string, geocodeAccuracy: string, workType = "Ext/CA GPS") =>
  ({ workType, street, geocodeAccuracy });

// ⚠️ An external asset with a real street number and a rooftop geocode is drawn like any other
// property — the asset is the kerb outside a lot we can actually find (Rhys, 2026-09-17).
check("5 Manson Street, Address", isCouncilAsset(ext("5 Manson Street", "Address")), false);
check("7-9 Manson Street, Address", isCouncilAsset(ext("7-9 Manson Street", "Address")), false);
check("30-34 Hickson Road, NearAddress", isCouncilAsset(ext("30-34 Hickson Road", "NearAddress")), false);

// No house number: nothing to look up, however good the geocode.
check("Hickson Roadway", isCouncilAsset(ext("Hickson Roadway", "Address")), true);
check("Barton Street", isCouncilAsset(ext("Barton Street", "Address")), true);
check("Crown Facades", isCouncilAsset(ext("Crown Facades", "Address")), true);

// ⚠️ A house number but a SUBURB-level geocode. This one covers three streets at once and
// cleans to a numbered street, so the text test alone would have drawn it on whatever parcel
// sits at the centroid.
check(
  "Council assets, 1-5 Polding Place, 6 & 12 Sturt St @ City",
  isCouncilAsset(ext("Council assets, 1-5 Polding Place, 6 & 12 Sturt St", "City")),
  true
);
// ⚠️ Block-level is still an exact address — the parcel lookup asks the address layer by text
// first, and falls back to a pin rather than a wrong lot.
check("a numbered street at Block accuracy", isCouncilAsset(ext("12 Smith Street", "Block")), false);
check("Bond Building Exterior - 30-34 Hickson Road @ Block", isCouncilAsset(ext("Bond Building Exterior - 30-34 Hickson Road", "Block")), false);

// Only external work types divert at all.
check("a residential unit", isCouncilAsset(ext("12 Smith Street", "City", "Res Unit")), false);
check("common areas", isCouncilAsset(ext("Common Areas", "City", "Common Areas")), false);

console.log("\ngroupWorkOrders — the real job, end to end");
const { properties, unmapped, skipped, councilAssets } = groupWorkOrders(fixture.rows);
check("work orders in", fixture.rows.length, 257);
// 257 work orders, 254 distinct Street strings, 42 distinct coordinates → 39 real properties.
// That collapse is the entire tool.
check("properties out", properties.length, 39);
// ⚠️ This job's one Ext/CA work order IS among them: "36 Culwulla Street" is an exact address
// at a rooftop geocode, so the lot is found and highlighted like any other. Only external
// assets with nothing findable to look up go on the hand-drawn list.
check("an external asset with an exact address is drawn", properties.some((p) => p.street === "36 Culwulla Street"), true);
check("so nothing is left to hand-draw here", councilAssets.length, 0);
check(
  "every work order accounted for",
  properties.reduce((n, p) => n + p.workOrders, 0) + unmapped.length + skipped.length + councilAssets.length,
  257
);
// Every real address is placed once the billing lines are out of the way.
check("nothing left unplaced", unmapped.length, 0);
check("billing lines skipped", skipped.length, 5);
check("  and only billing lines", [...new Set(skipped.map((s) => s.workType))], ["Billing Item"]);
// ⚠️ The `Access Letters` and `Induction` rows are Billing Item, which is why they go by WORK
// TYPE and not by their text — and so does this one, which reads as a perfectly good address.
check(
  "  including one that looks like an address",
  skipped.some((s) => s.street === "9 Derwent Street (Basement), Billing Item"),
  true
);

const byStreet = (s: string) => properties.find((p) => p.street === s);

const rickard = byStreet("1A Rickard Road");
check("1A Rickard Road is one property", rickard?.workOrders, 11);
check("  2 done, 9 failed → partial", rickard?.color, "partial");

const kg = byStreet("803-815 King Georges Road");
check("803-815 King Georges Road is one property, not 28", kg?.workOrders, 28);
check("  is PURPLE, not red or green", kg?.color, "partial");
check("  counts", kg?.counts, { green: 8, red: 20, orange: 0 });

// ⚠️ 17 units of this building all geocoded to "City" accuracy. An earlier rule dropped every
// coarse geocode and took the whole building off the drawing.
const coarseBuilding = byStreet("824-828 King Georges Road");
check("a City-accuracy building survives", coarseBuilding?.workOrders, 17);
check("  and merges with its precise twin", coarseBuilding?.precision, "precise");

// ⚠️ Three tenancies behind business names, each written as unit/address.
const newsagency = byStreet("48-50 Connells Point Road");
check("unit/address tenancies collapse", newsagency?.workOrders, 3);

const derwent = byStreet("9 Derwent Street");
// 74, not 75: the billing line that used to be counted here is not an inspection.
check("the biggest building", derwent?.workOrders, 74);
check("  33 done, 41 failed → partial", derwent?.color, "partial");
check("  counts exclude the billing line", derwent?.counts, { green: 33, red: 41, orange: 0 });

// ⚠️ Two different addresses on one geocode are two properties, not one and not none. An
// earlier rule kept the majority and discarded the rest; at Barangaroo that took 114 of 125
// work orders off the drawing, because eight High Street terraces share a point.
const shared = properties.filter((p) => p.sharedPoint);
check("shared-point addresses are kept as separate rows", shared.length, 6);
// 52 and 52a Connells Point Road, and 66A and 72, are two pairs Google put on one point each.
check(
  "  both halves of a shared pair survive",
  shared.filter((p) => p.street === "52 Connells Point Road" || p.street === "52a Connells Point Road").length,
  2
);
check("  and are never given a parcel from the shared point", shared.every((p) => p.precision !== "precise"), true);
check("  while keeping their own statuses", shared.every((p) => p.workOrders > 0), true);

check("the induction booking is skipped, not unmapped", skipped.some((s) => s.street === "Induction"), true);
check("no property is called Induction", properties.some((p) => p.street === "Induction"), false);
check("access letters are skipped", skipped.filter((s) => s.street === "Access Letters").length, 3);

// State and suburb come off the work order, so the cadastre provider is chosen with no Google
// call — which is what makes this tool free to run.
check("state resolved without geocoding", properties.every((p) => p.state === "NSW"), true);
check("suburb resolved", properties.every((p) => Boolean(p.suburb)), true);
check("every property has a street", properties.every((p) => p.street.length > 0), true);
check("every street looks like one", properties.every((p) => looksLikeAddress(p.street)), true);

// Coordinates are the join key and the tick state rides on it, so two properties must never
// share one.
check("keys unique", new Set(properties.map((p) => p.key)).size, properties.length);
// Nor may two rows claim the same address — that is the duplicate-pin bug mergeSameBuilding exists for.
check("addresses unique", new Set(properties.map((p) => p.street)).size, properties.length);

const colours = properties.reduce<Record<string, number>>((acc, p) => {
  acc[p.color] = (acc[p.color] ?? 0) + 1;
  return acc;
}, {});
console.log(
  `\n  ${properties.length} properties · ${councilAssets.length} council assets · ${unmapped.length} unmapped · ${skipped.length} skipped · colours ${JSON.stringify(colours)}`
);

if (failures) {
  console.log(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}
console.log("\nAll checks passed.\n");
