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
  ASSET_TYPES,
  SHEET_PRODUCTS,
  assetTypeApiValue,
  productByName,
  RATE_STEPS,
  rateToPicklistValue,
} from "@/lib/markup-layers/salesforce-picklists";
import { defaultDraft, initialDeselected, rowsFrom } from "@/lib/markup-layers/line-items";
import { sourcesFromSizing } from "@/lib/markup-layers/sources/from-sizing";
import { sourcesFromLayers } from "@/lib/markup-layers/sources/from-layers";
import type { MarkupLayer } from "@/lib/markup-layers/types";
import type { SizingResult } from "@/lib/property-sizing/types";
import { buildQuoteLineItems, rowReason } from "@/lib/quote-lines/payload";
import { parseBulkLines } from "@/lib/kml/standard-markup/bulk-parcels";

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
eq(productByName("Access Letters"), undefined, "per-job charges are not sheet products");
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

// ── Sizing adapter ──────────────────────────────────────────────────────────────────────
const base: SizingResult = {
  raw: "", street: "42 EASTERN AVE", suburb: "DOVER HEIGHTS", state: "NSW", postcode: "2030",
  lotSizeSqm: 313, lotPlan: "61//DP837", matchedAddress: "42 Eastern Ave, Dover Heights NSW 2030, Australia",
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
eq(markupSources.map((s) => s.seed.product), ["Standard Internal", "Standard Internal", "External GPS", "Standard Internal"], "colour → product");
eq(rowsFrom(markupSources, {}, new Set()).length, 3, "excluded layers are dropped");
eq(markupSources.map((s) => s.seed.levels), ["1", "1", "1", "1"], "a markup seeds one storey");
const untouched = rowsFrom(markupSources, {}, new Set())[0];
eq(untouched.touched.has("levels"), false, "levels starts untouched");
eq(rowsFrom(markupSources, { subject: { levels: "1" } }, new Set())[0].touched.has("levels"), true, "a click (same value written back) counts as touched");

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

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("✓ picklists, both adapters and the QuoteLineItem payload behave as agreed");
