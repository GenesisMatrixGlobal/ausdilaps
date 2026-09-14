// TRIAL HARNESS for the Street View storeys check (lib/storeys/street-view-storeys.ts — the
// same code the DEV tab runs), for auditing against a list of addresses:
//
//   npx tsx scripts/trial-storeys.ts <addresses.txt> [out-dir]
//
// Writes <out-dir>/<n>.jpg (the exact image the model judged) and <out-dir>/storeys.csv with
// the verdict, confidence, clear/check decision and a Street View link per address.

import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { parseAddressBlock } from "@/lib/property-sizing/parse";
import { displayStreet, lookupParcels } from "@/lib/property-sizing";
import { latLngRingFromArcgis } from "@/lib/property-sizing/rings";
import { streetViewUrl } from "@/lib/maps/street-view";
import { mapPool } from "@/lib/util/map-pool";
import { estimateStoreys, STOREYS_CONFIDENT } from "@/lib/storeys/street-view-storeys";

config({ path: ".env.local" });

const keys = { maps: process.env.GOOGLE_MAPS_API_KEY!, anthropic: process.env.ANTHROPIC_API_KEY! };
if (!keys.maps || !keys.anthropic) throw new Error("GOOGLE_MAPS_API_KEY and ANTHROPIC_API_KEY are needed in .env.local");

const [, , inputPath, outDir = "storeys-trial"] = process.argv;
if (!inputPath) throw new Error("usage: tsx scripts/trial-storeys.ts <addresses.txt> [out-dir]");
fs.mkdirSync(outDir, { recursive: true });

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const addresses = parseAddressBlock(fs.readFileSync(inputPath, "utf8"));
  console.log(`${addresses.length} addresses → ${outDir}/  (confident at ≥ ${STOREYS_CONFIDENT}%)`);
  const looked = await lookupParcels(addresses);
  const rows = await mapPool(
    looked.map((l, i) => ({ ...l, n: i + 1 })),
    4,
    async ({ addr, result, point, parcelRings, n }) => {
      const address = `${displayStreet(addr)}, ${addr.suburb} ${addr.state ?? ""} ${addr.postcode ?? ""}`.replace(/\s+/g, " ").trim();
      let image: string | null = null;
      try {
        const r = await estimateStoreys(
          { target: point, parcel: latLngRingFromArcgis(parcelRings), label: address },
          keys,
          (jpeg, attempt) => {
            // One file per angle tried: 012-1.jpg, 012-2.jpg… the CSV names the last one.
            const file = path.join(outDir, `${String(n).padStart(3, "0")}-${attempt}.jpg`);
            fs.writeFileSync(file, jpeg);
            image = file;
          }
        );
        return { n, address, lookup: result.status, r, image, link: point ? streetViewUrl(point) : null };
      } catch (e) {
        return { n, address, lookup: `${result.status}: ${(e as Error).message}`, r: null, image, link: point ? streetViewUrl(point) : null };
      }
    }
  );

  const header = ["#", "Address", "Lookup", "Angles tried", "Camera distance (m)", "Storeys (model)", "Confidence", "Facade visible", "Type", "Decision", "Notes", "Street View link", "Image"];
  const lines = [header.map(csvCell).join(",")];
  const tally = { clear: 0, check: 0, none: 0 };
  for (const row of rows) {
    const v = row.r?.status === "ok" ? row.r.verdict : null;
    const decision = v ? (v.clear ? "clear" : "check") : "no_image";
    tally[v ? (v.clear ? "clear" : "check") : "none"]++;
    lines.push(
      [row.n, row.address, row.r && row.r.status !== "ok" ? `${row.lookup}: ${row.r.status}` : row.lookup, v?.attempts ?? "", v ? Math.round(v.cameraDistanceM) : "", v?.storeys ?? "", v?.confidence ?? "", v ? (v.facadeVisible ? "yes" : "no") : "", v?.buildingType ?? "", decision, v?.notes ?? "", row.link ?? "", row.image ?? ""]
        .map(csvCell)
        .join(",")
    );
    console.log(`${String(row.n).padStart(3)}  ${decision.padEnd(8)} ${v ? `${v.storeys ?? "?"} storey @${v.confidence}% ${v.facadeVisible ? "" : "(facade hidden) "}[${v.buildingType}]` : row.r?.status ?? row.lookup}  ${row.address}`);
  }
  fs.writeFileSync(path.join(outDir, "storeys.csv"), `﻿${lines.join("\r\n")}\r\n`);
  console.log(`\nclear ${tally.clear} · check ${tally.check} · no image ${tally.none}  →  ${path.join(outDir, "storeys.csv")}`);
}

void main();
