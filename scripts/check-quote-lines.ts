// Quote Line Item sheet — mapping and payload check. Pure: no env, no network, no database.
//
//   npx tsx scripts/check-quote-lines.ts
//
// Asserts the things a Salesforce create would otherwise discover one failed row at a time:
// every sheet product has an Id and an asset type the picklist knows; both tool adapters
// produce the seeds agreed with Rhys; and buildQuoteLineItems() sends exactly the agreed
// fields (UnitPrice 1, no Description) and refuses exactly the rows it should. Exits non-zero
// on any failure, so it can gate a commit.

import {
  ALL_PRODUCTS,
  ASSET_TYPES,
  PRODUCT_NAMES,
  SHEET_PRODUCTS,
  assetTypeApiValue,
  productByName,
  RATE_STEPS,
  rateToPicklistValue,
} from "@/lib/markup-layers/salesforce-picklists";
import { defaultDraft, initialDeselected, levelsUnchecked, rowsFrom, selectAllKeys } from "@/lib/markup-layers/line-items";
import { ACCESS_LETTERS_KEY, blockStreet, withDerivedSources } from "@/lib/markup-layers/derived";
import { sourcesFromSizing } from "@/lib/markup-layers/sources/from-sizing";
import { sourcesFromLayers } from "@/lib/markup-layers/sources/from-layers";
import type { MarkupLayer } from "@/lib/markup-layers/types";
import type { SizingResult } from "@/lib/property-sizing/types";
import { buildQuoteLineItems, rowReason } from "@/lib/quote-lines/payload";
import { parseBulkLines } from "@/lib/kml/standard-markup/bulk-parcels";
import { lineItemsCsv } from "@/lib/quote-lines/csv";

let failures = 0;
function fail(msg: string) {
  failures++;
  console.error(`✗ ${msg}`);
}
function eq<T>(actual: T, want: T, what: string) {
  if (JSON.stringify(actual) !== JSON.stringify(want)) fail(`${what}: got ${JSON.stringify(actual)}, want ${JSON.stringify(want)}`);
}

// ── Picklists ───────────────────────────────────────────────────────────────────────────
const ids = new Set<string>();
for (const p of SHEET_PRODUCTS) {
  if (!/^01t[a-zA-Z0-9]{12}$/.test(p.product2Id)) fail(`${p.name}: Product2Id ${p.product2Id} is not a 15-char 01t id`);
  if (ids.has(p.product2Id)) fail(`${p.name}: duplicate Product2Id`);
  ids.add(p.product2Id);
  if (!assetTypeApiValue(p.assetType)) fail(`${p.name}: asset type "${p.assetType}" has no API value`);
}
eq(SHEET_PRODUCTS.length, 10, "sheet product count");
eq(ASSET_TYPES.length, 9, "asset type count");
eq(assetTypeApiValue("Standard Internal - Low Density"), "Warehouse", "Low Density API value");
eq(productByName("Video Roadways")?.assetType, "Video Roadway", "Video Roadways → Video Roadway");
eq(productByName("Rail Infrastructure")?.assetType, "Standard Internal - High Density", "Rail → High Density");
// Access Letters is a JOB product since 2026-09-30: syncable (the sheet adds it itself), but
// never offered in the per-property dropdown. The other per-job charges stay unknown.
eq(PRODUCT_NAMES.includes("Access Letters"), false, "per-job charges are not in the dropdown");
eq(productByName("Access Letters")?.unitPrice, 35, "Access Letters resolves, at $35");
eq(productByName("DOA"), undefined, "other per-job charges are still not sheet products");
if (!RATE_STEPS.internal.includes("0.80")) fail("internal default 0.80 is not a rate step");
if (!RATE_STEPS.external.includes("0.30")) fail("external default 0.30 is not a rate step");
if (RATE_STEPS.internal.includes("0.55")) fail("internal steps above 0.50 must be 10c");
if (!RATE_STEPS.internal.includes("0.45")) fail("internal steps below 0.50 must be 5c");
// Verbatim from the org's describe, 2026-09-11.
eq(rateToPicklistValue("external", "0.30"), ".30", "external picklist API value has no leading zero");
eq(rateToPicklistValue("internal", "0.80"), "0.80", "internal picklist API value");
eq(rateToPicklistValue("internal", "0.60"), "0.6", "the org's one odd API value");
eq(rateToPicklistValue("internal", "0.83"), undefined, "off-step rate has no API value");
eq(RATE_STEPS.internal.length, 17, "17 internal options");
eq(RATE_STEPS.external.length, 15, "15 external options");

// ── Bulk lines (the DEV tab's paste box) ────────────────────────────────────────────────
const lines = parseBulkLines("+ 44 Eastern Avenue, Dover Heights NSW 2030\n42\tEASTERN AVE\tDOVER HEIGHTS NSW 2030\n\n+11 Craig Ave, Vaucluse NSW 2030\n");
eq(lines.map((l) => l.withNeighbours), [true, false, true], "+ marks a line for adjoining lots");
eq(lines.map((l) => l.addr.street), ["44 Eastern Avenue", "42 EASTERN AVE", "11 Craig Ave"], "marker is peeled off before parsing");
eq(lines.map((l) => l.addr.suburb), ["Dover Heights", "DOVER HEIGHTS", "Vaucluse"], "suburbs survive the marker");
const inherit = parseBulkLines("42 Eastern Ave Dover Heights NSW 2030\n44 Eastern Ave Dover Heights\n13 Craig Ave, Vaucluse");
eq(inherit.map((l) => l.addr.state), ["NSW", "NSW", "NSW"], "state-less lines inherit the list's state");
eq(parseBulkLines("42 Eastern Ave Dover Heights").map((l) => l.addr.state), [undefined], "nothing to inherit → unknown");
// A place with no street address arrives as its coordinate plus the name the search showed.
const coord = parseBulkLines("+ -33.770034, 151.037490 The Don Moore Community Centre, Carlingford NSW\n-33.77, 151.03\n12, 151 Smith St Carlingford");
eq(coord.map((l) => l.point ?? null), [{ lat: -33.770034, lng: 151.03749 }, { lat: -33.77, lng: 151.03 }, null], "a coordinate pair leads a point line; a house number never has decimals");
eq(coord.map((l) => l.withNeighbours), [true, false, false], "+ works on a point line too");
eq(coord[0].addr.street, "The Don Moore Community Centre", "the place name is the row's street");
eq(coord.map((l) => l.addr.state), ["NSW", "NSW", "NSW"], "a bare pair inherits the list's state");

// ── Sizing adapter ──────────────────────────────────────────────────────────────────────
const base: SizingResult = {
  raw: "", street: "42 EASTERN AVE", suburb: "DOVER HEIGHTS", state: "NSW", postcode: "2030",
  // ⚠️ 216, not the 313 this said until 2026-09-17. That figure was the NSW cadastre's
  // shape_Area — Web Mercator, inflated 1.45x at Sydney — captured here as if it were real.
  // 216 m² is what the lot's own ring measures, which is what the adapter reports now.
  lotSizeSqm: 216, lotPlan: "61//DP837", matchedAddress: "42 Eastern Ave, Dover Heights NSW 2030, Australia",
  matchScore: null, source: "NSW DCDB", levels: 2, levelsConfidence: 60, dwellingAreaSqm: 187.4,
  dwellingAreaConfidence: 40, status: "ok", flags: [],
};
const sizing: SizingResult[] = [
  base,
  { ...base, street: "Unit 1/48 EASTERN AVE", dwellingAreaSqm: 90 },
  { ...base, street: "41 EASTERN AVE", status: "number_mismatch", flags: ["geocoder matched No. 41"] },
  { ...base, street: "99 NOWHERE ST", status: "not_found", lotSizeSqm: null, dwellingAreaSqm: null },
];
const sizingSources = sourcesFromSizing(sizing);
eq(sizingSources.map((s) => s.seed.product), ["Residential House", "Residential Unit", "Residential House", "Residential House"], "sizing products");
eq(sizingSources.map((s) => s.seed.internalMetres), ["187", "90", "187", ""], "dwelling → internal m²");
eq(sizingSources.map((s) => s.seed.externalMetres), ["", "", "", ""], "external stays blank");
eq(sizingSources.map((s) => s.seed.levels), ["2", "2", "2", "2"], "storey estimate seeds Levels");
eq(sourcesFromSizing([{ ...base, levels: null }])[0].seed.levels, "1", "no estimate → one storey");
eq([...initialDeselected(sizingSources)], ["sizing:2", "sizing:3"], "non-ok rows start unticked");
const sizingRows = rowsFrom(sizingSources, {}, initialDeselected(sizingSources));
eq(sizingRows.map((r) => r.number), [1, 2, null, null], "numbering skips unticked rows");
eq(defaultDraft(sizingSources[0]).suburb, "DOVER HEIGHTS", "suburb seeded");

// ── Markup adapter ──────────────────────────────────────────────────────────────────────
const layer = (over: Partial<MarkupLayer>): MarkupLayer => ({
  key: "k", kind: "lot", label: "Lot", areaSqm: 600, lengthMetres: null, widthMetres: null, lotPlan: "1RP1",
  street: "14 Albany Creek Rd", suburb: "Aspley", mode: null, color: "blue", included: true, points: [], ...over,
});
const markupSources = sourcesFromLayers([
  layer({ key: "subject", kind: "subject", label: "Site", color: "red" }),
  layer({ key: "lot:1", color: "blue" }),
  layer({ key: "shape:o", kind: "shape", label: "Shape", color: "orange", street: null, lotPlan: null, mode: "area" }),
  layer({ key: "lot:x", included: false }),
]);
eq(markupSources.map((s) => s.seed.internalMetres), ["", "600", "", "600"], "blue seeds internal, red seeds nothing");
eq(markupSources.map((s) => s.seed.externalMetres), ["", "", "600", ""], "orange seeds external");
eq(markupSources[2].seed.street, "Council assets", "orange street default");
eq(markupSources.map((s) => s.seed.product), ["Standard Internal", "Residential House", "External GPS", "Residential House"], "colour → product: blue is a house");
eq(rowsFrom(markupSources, {}, new Set()).length, 3, "excluded layers are dropped");
eq([...initialDeselected(markupSources)], ["subject"], "the red site starts unticked; blue and orange start ticked");
eq(rowsFrom(markupSources, {}, initialDeselected(markupSources)).map((r) => r.number), [null, 1, 2], "numbering starts at the first ticked row");
eq(markupSources.map((s) => s.seed.levels), ["1", "1", "", "1"], "a markup seeds one storey — none for an orange shape");
const untouched = rowsFrom(markupSources, {}, new Set())[0];
eq(untouched.touched.has("levels"), false, "levels starts untouched");
eq(rowsFrom(markupSources, { subject: { levels: "1" } }, new Set())[0].touched.has("levels"), true, "a click (same value written back) counts as touched");
eq(rowsFrom(markupSources, {}, new Set()).map(levelsUnchecked), [true, true, false], "seeded levels need a check; the orange shape's blank does not");
eq(levelsUnchecked(rowsFrom(markupSources, { subject: { levels: "1" } }, new Set())[0]), false, "checked once, no longer flagged");

// ── Payload ─────────────────────────────────────────────────────────────────────────────
const pricebook = new Map(SHEET_PRODUCTS.map((p) => [p.product2Id, `pbe-${p.product2Id}`]));
pricebook.delete(productByName("Video Roadways")!.product2Id); // not on this Quote's book
const draft = (over: Partial<ReturnType<typeof defaultDraft>>) => ({ ...defaultDraft(sizingSources[0]), ...over });
const { records, refused } = buildQuoteLineItems(
  [
    { key: "a", values: draft({}) },
    { key: "b", values: draft({ product: "External GPS", internalMetres: "", externalMetres: "1,200", externalRate: "0.35", quantity: "2" }) },
    { key: "c", values: draft({ internalMetres: "", externalMetres: "" }) },
    { key: "d", values: draft({ product: "" }) },
    { key: "e", values: draft({ product: "Mobilisation" }) },
    { key: "f", values: draft({ quantity: "0" }) },
    { key: "g", values: draft({ product: "Video Roadways" }) },
    { key: "h", values: draft({ assetType: "Other", internalMetres: "50", externalMetres: "20", levels: "" }) },
    { key: "i", values: draft({ internalRate: "0.83" }) },
  ],
  { quoteId: "0Q0TEST", pricebookEntryByProduct2Id: pricebook }
);
eq(refused.map((r) => [r.key, r.reason]), [
  ["c", "no internal or external m²"],
  ["d", "no product chosen"],
  ["e", '"Mobilisation" isn\'t a product this sheet can sync'],
  ["f", "quantity must be above 0"],
  ["g", '"Video Roadways" isn\'t on this Quote\'s price book'],
  ["i", "internal rate $0.83 isn't one of the picklist's values"],
], "refusals");
eq(records.length, 3, "records created");
const [a, b, h] = records;
eq(a.UnitPrice, 1, "UnitPrice placeholder");
if ("Description" in a) fail("Description must not be sent");
eq(a.QuoteId, "0Q0TEST", "QuoteId");
eq(a.PricebookEntryId, `pbe-${productByName("Residential House")!.product2Id}`, "PBE from the Quote's book");
eq(a.Product2Id, "01t96000000GNqD", "Product2Id");
eq(a.Property_Type__c, "Commercial", "asset type API value");
eq(a.Levels__c, 2, "Levels__c from the sheet's Levels cell");
eq([a.Street__c, a.Suburb__c], ["42 EASTERN AVE", "DOVER HEIGHTS"], "Street__c / Suburb__c from the cells");
eq(a.Internal_M2__c, 187, "internal m² rounded");
eq(a.Internal_M2_Rate__c, 0.8, "internal rate currency");
eq(a.Internal_Rate_PL__c, "0.80", "internal rate picklist");
if ("External_M2__c" in a || "External_Rate__c" in a) fail("blank external must not send external fields");
eq(b.Quantity, 2, "quantity parsed");
eq(b.External_M2__c, 1200, "external m² with thousands separator");
eq(b.External_Rate__c, 0.35, "external rate currency");
eq(b.External_Rate_PL__c, ".35", "external rate picklist, org format");
eq(b.Property_Type__c, "External_GPS", "External GPS API value");
if ("Internal_M2__c" in b) fail("blank internal must not send internal fields");
eq(h.Property_Type__c, "Other", "asset type override wins");
eq([h.Internal_M2__c, h.External_M2__c], [50, 20], "both measurements on one line");
if ("Levels__c" in h) fail("blank Levels must not be sent");
eq(rowReason(draft({})), null, "a default sizing row is sendable");

// ── CSV export ──────────────────────────────────────────────────────────────────────────
{
  const csvRows = rowsFrom(sourcesFromSizing(sizing), { "sizing:0": { street: 'Unit 1, "The Towers"' } }, new Set(["sizing:2"]));
  const csv = lineItemsCsv(csvRows);
  const csvLines = csv.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
  eq(csvLines[0], "#,Street,Suburb,Product,Asset type,Levels,Internal m²,External m²,Internal $/m²,External $/m²,Qty", "CSV header is the sheet's columns");
  eq(csvLines.length, 1 + csvRows.filter((r) => r.selected).length, "CSV carries ticked rows only");
  eq(csvLines[1].startsWith('1,"Unit 1, ""The Towers""",DOVER HEIGHTS,Residential House,Standard Internal,'), true, "commas and quotes are RFC 4180 quoted; asset type is the effective one");
  eq(csv.startsWith("\uFEFF"), true, "BOM so Excel reads the ² as UTF-8");
}

// ── Derived rows: Access Letters + Common Areas (lib/markup-layers/derived.ts) ────────────
{
  const lots = sourcesFromLayers([
    layer({ key: "lot:1RP1", street: "2 Smith St", areaSqm: 500 }),
    layer({ key: "lot:2RP1", street: "4 Smith St", areaSqm: 520 }),
    layer({ key: "lot:9SP5", street: "1/10 Smith St", areaSqm: 1200 }),
    layer({ key: "lot:9SP5#2", street: "2/10 Smith St", areaSqm: 1200 }),
    layer({ key: "lot:9SP5#3", street: "3/10 Smith St", areaSqm: 1200 }),
    layer({ key: "lot:7RP2", street: "Unit 4, 20 Jones Rd", areaSqm: 800 }),
  ]);
  const unitKeys = ["lot:9SP5", "lot:9SP5#2", "lot:9SP5#3", "lot:7RP2"];
  const drafts = Object.fromEntries(unitKeys.map((k) => [k, { product: "Residential Unit" }]));
  const pass = (des: Set<string>) => {
    const first = rowsFrom(lots, drafts, des);
    const all = withDerivedSources(lots, first);
    return { all, rows: rowsFrom(all, drafts, des) };
  };
  const { all, rows: dRows } = pass(new Set());
  const letters = dRows.find((r) => r.key === ACCESS_LETTERS_KEY)!;
  eq(letters.values.quantity, "6", "Access Letters: one per ticked residential row (2 houses + 4 units)");
  eq(letters.selected, true, "Access Letters starts ticked");
  eq(dRows[dRows.length - 1].key, ACCESS_LETTERS_KEY, "Access Letters is last");
  const common = dRows.filter((r) => r.key.startsWith("auto:common:"));
  eq(common.map((r) => r.key), ["auto:common:lot:9SP5", "auto:common:lot:7RP2"], "Common Areas: one per address");
  eq(common.map((r) => r.selected), [false, false], "Common Areas start unticked");
  eq(common.map((r) => r.values.internalMetres), ["1200", "800"], "Common Areas seeded with the lot's area");
  eq(common.map((r) => r.values.street), ["10 Smith St", "20 Jones Rd"], "Common Areas street is the block's address");
  eq(common.map((r) => r.values.product), ["Common Areas (30%)", "Common Areas (30%)"], "Common Areas product");
  eq(all.findIndex((s) => s.key === "auto:common:lot:9SP5"), all.findIndex((s) => s.key === "lot:9SP5#3") + 1, "Common Areas sits after its block's last unit");
  // Unticking a house drops the count; ticking a Common Areas row (opt-in) puts its key IN the set.
  eq(pass(new Set(["lot:1RP1"])).rows.find((r) => r.key === ACCESS_LETTERS_KEY)!.values.quantity, "5", "unticking a house drops the letters by one");
  eq(pass(new Set(["auto:common:lot:7RP2"])).rows.find((r) => r.key === "auto:common:lot:7RP2")!.selected, true, "ticking an opt-in row records it in the set");
  eq(selectAllKeys(all, true).has("auto:common:lot:7RP2"), true, "select all ticks opt-in rows too");
  eq(selectAllKeys(all, true).has("lot:1RP1"), false, "select all leaves ordinary rows out of the set");
  eq(selectAllKeys(all, false).has("auto:common:lot:7RP2"), false, "select none unticks opt-in rows");
  eq(selectAllKeys(all, false).has(ACCESS_LETTERS_KEY), true, "select none unticks Access Letters");
  // No residential rows → no Access Letters.
  const commercial = sourcesFromLayers([layer({ key: "lot:c", street: "1 X St" })]);
  const cDrafts = { "lot:c": { product: "Warehouse" } };
  eq(withDerivedSources(commercial, rowsFrom(commercial, cDrafts, new Set())).some((s) => s.key === ACCESS_LETTERS_KEY), false, "no residential rows, no letters");
  eq(blockStreet("3/12 Smith St"), "12 Smith St", "unit slash stripped");
  eq(blockStreet("U3 12 Smith St"), "12 Smith St", "U prefix stripped");
  eq(blockStreet("12 Smith St"), "12 Smith St", "a plain address is untouched");

  // Payload: Access Letters goes at $35 x qty with no m² and no asset type.
  const book = new Map(ALL_PRODUCTS.map((p) => [p.product2Id, `pbe-${p.product2Id}`]));
  eq(rowReason(letters.values), null, "Access Letters needs no m²");
  const built = buildQuoteLineItems(
    [{ key: letters.key, values: letters.values }, { key: common[0].key, values: common[0].values }],
    { quoteId: "q", pricebookEntryByProduct2Id: book }
  );
  eq(built.refused.length, 0, "both derived rows sync");
  eq([built.records[0].UnitPrice, built.records[0].Quantity, built.records[0].Internal_M2__c, built.records[0].Property_Type__c], [35, 6, undefined, undefined], "Access Letters: $35 x 6, no m², no asset type");
  eq([built.records[1].UnitPrice, built.records[1].Internal_M2__c, built.records[1].Property_Type__c], [1, 1200, "Common Areas"], "Common Areas: placeholder price, lot area, asset type");
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("✓ picklists, both adapters and the QuoteLineItem payload behave as agreed");
