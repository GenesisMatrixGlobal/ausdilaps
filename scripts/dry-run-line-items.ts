// Prints the Quote Line Item sheet a saved Building Markup — or a Bulk Property Sizing result
// — produces, and the QuoteLineItem records a sync would create from it. Reads nothing else
// and writes nothing anywhere — no Salesforce, no Box, no network, no creds.
//
//   npx tsx scripts/dry-run-line-items.ts <markup>.json
//   npx tsx scripts/dry-run-line-items.ts --sample              (a built-in markup, for eyeballing)
//   npx tsx scripts/dry-run-line-items.ts --sizing <results>.json (the JSON /api/property-sizing returns)
//
// It renders the SAME rows the tool shows on screen, off the same file and the same
// rowsFrom() — so if the two ever disagree, one of them is a bug rather than a second opinion.

import { readFileSync } from "node:fs";
import { buildBuildingMarkupFile, parseBuildingMarkupFile } from "@/lib/maps/building-markup-file";
import { layersFrom } from "@/lib/markup-layers/plan";
import { assetTypeFor, initialDeselected, rowsFrom, type LineItemRow } from "@/lib/markup-layers/line-items";
import { sourcesFromLayers } from "@/lib/markup-layers/sources/from-layers";
import { sourcesFromSizing } from "@/lib/markup-layers/sources/from-sizing";
import type { LineItemSource } from "@/lib/markup-layers/source";
import { buildQuoteLineItems } from "@/lib/quote-lines/payload";
import { SHEET_PRODUCTS } from "@/lib/markup-layers/salesforce-picklists";
import type { SizingResult } from "@/lib/property-sizing/types";

const LIMITS = { maxShapePoints: 20, maxRingPoints: 2000, minWidth: 5, maxWidth: 30 };

/** A deliberately awkward markup: a subject plus a redrawn red site, a lot with no area, an
 *  unticked lot, an orange line and area (external), and a blue line (internal). */
function sampleFile(): string {
  const c = { lat: -27.3639, lng: 153.0158 };
  const d = (m: number) => m / 111320;
  const dl = (m: number) => m / (111320 * Math.cos((c.lat * Math.PI) / 180));
  const box = (n: number, e: number, dn: number, de: number) => [
    { lat: c.lat + d(n), lng: c.lng + dl(e) },
    { lat: c.lat + d(n), lng: c.lng + dl(e + de) },
    { lat: c.lat + d(n - dn), lng: c.lng + dl(e + de) },
    { lat: c.lat + d(n - dn), lng: c.lng + dl(e) },
  ];
  return JSON.stringify(
    buildBuildingMarkupFile({
      address: { street: "12 Albany Creek Road", suburb: "Aspley", postcode: "4034", state: "QLD" },
      matchedAddress: "12 Albany Creek Rd, Aspley QLD 4034",
      mapType: "hybrid",
      subjectRing: box(0, 0, 30, 20),
      subjectLotPlan: "3RP12345",
      subjectAreaSqm: 612,
      neighbours: [
        { id: "4RP12345", ring: box(0, 22, 30, 20), areaSqm: 598, street: "14 Albany Creek Road", suburb: "Aspley" },
        { id: "5RP12345", ring: box(0, -22, 30, 20), areaSqm: 1840, street: "10 Albany Creek Road", suburb: "Aspley" },
        // No address from the layer, and no area from the cadastre — both cells come up blank.
        { id: "6RP12345", ring: box(34, 0, 30, 20), areaSqm: null },
      ],
      frame: { center: c, fitZoom: 19 },
      zoomAdjust: 1,
      excludedIds: ["6RP12345"],
      hideSubject: false,
      shapes: [
        // Orange line along the frontage — external.
        { id: "s1", mode: "line", widthMetres: 10, color: "orange",
          points: [{ lat: c.lat - d(34), lng: c.lng - dl(30) }, { lat: c.lat - d(34), lng: c.lng + dl(50) }] },
        // Orange area behind the kerb — external.
        { id: "s2", mode: "area", widthMetres: 10, color: "orange", points: box(-32, 0, 6, 40) },
        // Red — a redrawn site boundary. Seeds neither side, like the detected site.
        { id: "s3", mode: "area", widthMetres: 10, color: "red", points: box(0, 0, 30, 20) },
        // Blue line — internal.
        { id: "s4", mode: "line", widthMetres: 5, color: "blue",
          points: [{ lat: c.lat + d(4), lng: c.lng + dl(22) }, { lat: c.lat - d(26), lng: c.lng + dl(22) }] },
      ],
      lineItems: {
        // One row already priced by hand, to prove the overrides survive a round trip.
        "lot:4RP12345": { product: "Residential House", internalMetres: "180" },
      },
      deselected: ["shape:s3"],
    }),
    null,
    2
  );
}

function pad(value: string, width: number): string {
  // Padded on display WIDTH, not string length — "m²" and "·" are multi-byte and
  // String.padEnd counts code units, which knocks every later column out by one.
  const w = [...value].length;
  return value + " ".repeat(Math.max(0, width - w));
}

function printSheet(sources: LineItemSource[], rows: LineItemRow[]) {
  console.log("\nQUOTE LINE ITEMS");
  console.log(
    `  ${pad("", 2)}${pad("ITEM", 14)}${pad("STREET", 24)}${pad("SUBURB", 14)}` +
      `${pad("PRODUCT", 26)}${pad("ASSET TYPE", 34)}${pad("LVL", 5)}${pad("INT m²", 8)}${pad("EXT m²", 8)}` +
      `${pad("INT $", 7)}${pad("EXT $", 7)}QTY`
  );
  for (const r of rows) {
    const v = r.values;
    console.log(
      `  ${pad(r.selected ? "☑" : "☐", 2)}${pad(`${r.number ?? "—"} · ${r.source.label}`, 14)}${pad(v.street || "—", 24)}` +
        `${pad(v.suburb || "—", 14)}${pad(v.product || "— none —", 26)}${pad(assetTypeFor(v) || "—", 34)}${pad(v.levels || "—", 5)}` +
        `${pad(v.internalMetres || "—", 8)}${pad(v.externalMetres || "—", 8)}` +
        `${pad(v.internalRate, 7)}${pad(v.externalRate, 7)}${v.quantity}`
    );
  }

  const excluded = sources.filter((s) => !s.included);
  if (excluded.length > 0) {
    console.log("\nNOT ON THE SHEET");
    for (const s of excluded) {
      console.log(
        `  ${pad(s.label, 14)}${s.detail.kind === "markup" && s.detail.layer.kind === "shape" ? "not enough points to measure" : "unticked on the markup"}`
      );
    }
  }

  // The records a sync would send, against a pretend price book that has every sheet product —
  // so the only refusals printed are the sheet's own (no product, no m², qty 0).
  const pricebook = new Map(SHEET_PRODUCTS.map((p) => [p.product2Id, `pbe-${p.product2Id}`]));
  const { records, refused } = buildQuoteLineItems(
    rows.filter((r) => r.selected).map((r) => ({ key: r.key, values: r.values })),
    { quoteId: "0Q0-DRY-RUN", pricebookEntryByProduct2Id: pricebook }
  );
  if (refused.length > 0) {
    console.log("\nWOULD BE REFUSED");
    for (const r of refused) console.log(`  ⚠ ${r.street || r.key}: ${r.reason}`);
  }
  console.log("\nQUOTELINEITEM RECORDS");
  for (const rec of records) {
    const { attributes: _a, QuoteId: _q, ...fields } = rec;
    void _a; void _q;
    console.log(`  ${JSON.stringify(fields)}`);
  }

  const selected = rows.filter((r) => r.selected).length;
  console.log(
    `\n${selected} of ${rows.length} row(s) selected → ${records.length} record(s). Nothing was written to Salesforce.\n`
  );
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: dry-run-line-items.ts <markup>.json | --sample | --sizing <results>.json");
    process.exit(2);
  }

  if (arg === "--sizing") {
    const path = process.argv[3];
    if (!path) {
      console.error("usage: dry-run-line-items.ts --sizing <results>.json");
      process.exit(2);
    }
    const doc = JSON.parse(readFileSync(path, "utf8")) as { results?: SizingResult[] } | SizingResult[];
    const results = Array.isArray(doc) ? doc : doc.results ?? [];
    const sources = sourcesFromSizing(results);
    console.log(`\nBulk Property Sizing · ${results.length} address(es)`);
    printSheet(sources, rowsFrom(sources, {}, initialDeselected(sources)));
    return;
  }

  const text = arg === "--sample" ? sampleFile() : readFileSync(arg, "utf8");

  const parsed = parseBuildingMarkupFile(text, LIMITS);
  if (!parsed.ok) {
    console.error(`Couldn't read that markup: ${parsed.error}`);
    process.exit(1);
  }
  const file = parsed.file;

  console.log(`\n${file.address.street}, ${file.address.suburb} ${file.address.state}`);
  console.log(
    `file v${file.version} · saved ${file.savedAt.slice(0, 16).replace("T", " ")} · ` +
      `${file.neighbours.length} detected lot(s), ${file.shapes.length} shape(s)` +
      (parsed.skippedShapes ? ` · ${parsed.skippedShapes} unreadable shape(s)` : "")
  );

  const sources = sourcesFromLayers(layersFrom(file));
  // The operator's own cells and tick state, which the file carries — without them the dry run
  // prints the defaults and silently disagrees with what the tool is showing on screen.
  printSheet(sources, rowsFrom(sources, file.lineItems ?? {}, new Set(file.deselected ?? [])));
}
main();
