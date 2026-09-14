// TRIAL — can Street View + vision tell one storey from two, well enough to clear the sheet's
// orange Levels cell on its own?
//
//   npx tsx scripts/trial-storeys.ts <addresses.txt> [out-dir]
//
// Per address: verified point (the sizing pipeline's lookup), Street View metadata (free) for
// the camera and a heading at the property, ONE Street View Static image (billed, ~0.7c), one
// vision call. Writes <out-dir>/<n>.jpg and <out-dir>/storeys.csv for a human audit, and prints
// a summary. Decision rule under test: clear the highlight ONLY when the model says 1 storey,
// confidence >= 80 and the facade is visible; anything else stays orange.

import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { parseAddressBlock } from "@/lib/property-sizing/parse";
import { displayStreet, lookupParcels } from "@/lib/property-sizing";
import { pointInRing, projectToLocalMetres } from "@/lib/kml/standard-markup/geometry";
import { latLngRingFromArcgis } from "@/lib/property-sizing/rings";
import type { LatLng } from "@/lib/kml/types";
import { streetViewUrl } from "@/lib/maps/street-view";
import { mapPool } from "@/lib/util/map-pool";

config({ path: ".env.local" });

const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;
const MODEL = process.env.STOREYS_TRIAL_MODEL ?? "claude-sonnet-5";
if (!MAPS_KEY || !ANTHROPIC_KEY) throw new Error("GOOGLE_MAPS_API_KEY and ANTHROPIC_API_KEY are needed in .env.local");

const [, , inputPath, outDir = "storeys-trial"] = process.argv;
if (!inputPath) throw new Error("usage: tsx scripts/trial-storeys.ts <addresses.txt> [out-dir]");
fs.mkdirSync(outDir, { recursive: true });

interface Verdict {
  storeys: number | null;
  confidence: number;
  facade_visible: boolean;
  building_type: string;
  notes: string;
}

interface Row {
  n: number;
  address: string;
  status: string;
  camera?: { lat: number; lng: number; heading: number; distanceM: number };
  verdict?: Verdict;
  decision: "clear" | "check" | "no_image";
  link: string | null;
  image: string | null;
}

interface Meta {
  status?: string;
  copyright?: string;
  location?: { lat: number; lng: number };
  pano_id?: string;
}

async function metadata(location: string): Promise<Meta> {
  const params = new URLSearchParams({ location, radius: "70", source: "outdoor", key: MAPS_KEY });
  const res = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?${params}`);
  return (await res.json()) as Meta;
}

/** A GOOGLE panorama on the STREET. Two traps, both hit on the first runs: by coordinate the
 *  nearest panorama is often a business's own indoor photosphere (`source=outdoor` does not
 *  exclude them, and some are even "© Google" — a florist's shelves came back so labelled), so a
 *  camera INSIDE the property's own parcel is rejected; and the address-text fallback lands on
 *  the same indoor views. So the target point and a ring of offsets around it (25 m and 45 m,
 *  four directions — one of them is the road) are each asked for their nearest panorama, and
 *  the closest Google camera standing outside the parcel wins. All metadata calls are free. */
async function camera(lat: number, lng: number, parcel: LatLng[] | null) {
  const target = { lat, lng };
  const offsets: LatLng[] = [target];
  for (const r of [25, 45]) {
    const dLat = r / 111_320;
    const dLng = dLat / Math.cos((lat * Math.PI) / 180);
    offsets.push({ lat: lat + dLat, lng }, { lat: lat - dLat, lng }, { lat, lng: lng + dLng }, { lat, lng: lng - dLng });
  }
  const seen = new Set<string>();
  let best: { lat: number; lng: number; heading: number; distanceM: number; pano?: string } | null = null;
  for (const o of offsets) {
    const data = await metadata(`${o.lat.toFixed(7)},${o.lng.toFixed(7)}`);
    if (data.status !== "OK" || !data.location || !/google/i.test(data.copyright ?? "")) continue;
    if (data.pano_id && seen.has(data.pano_id)) continue;
    if (data.pano_id) seen.add(data.pano_id);
    if (parcel && pointInRing(data.location, parcel)) continue; // indoors, or in the yard
    const { east, north } = projectToLocalMetres(data.location, target);
    const distanceM = Math.hypot(east, north);
    if (distanceM < 5) continue;
    if (best && best.distanceM <= distanceM) continue;
    const heading = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
    best = { lat: data.location.lat, lng: data.location.lng, heading, distanceM, pano: data.pano_id };
  }
  return best;
}

async function image(cam: { pano?: string; lat: number; lng: number; heading: number }, file: string) {
  const params = new URLSearchParams({
    size: "640x480",
    heading: cam.heading.toFixed(1),
    fov: "75",
    pitch: "8",
    source: "outdoor",
    key: MAPS_KEY,
    ...(cam.pano ? { pano: cam.pano } : { location: `${cam.lat},${cam.lng}` }),
  });
  const res = await fetch(`https://maps.googleapis.com/maps/api/streetview?${params}`);
  if (!res.ok) throw new Error(`Street View image ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf.toString("base64");
}

async function judge(b64: string, address: string): Promise<Verdict> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
            {
              type: "text",
              text:
                `This is a Google Street View photo aimed at the property "${address}" (Australia). ` +
                `The property of interest should be roughly in the centre of the frame. Count its above-ground storeys (habitable levels; a garage under a house counts as a level). ` +
                `Reply with JSON only: {"storeys": <integer or null if you cannot tell>, "confidence": <0-100>, "facade_visible": <true if you can see most of the building's front>, ` +
                `"building_type": "house" | "units" | "commercial" | "vacant" | "other", "notes": "<one short sentence>"}. ` +
                `Be conservative: if trees, fences, distance or angle hide the upper part of the building, lower the confidence.`,
            },
          ],
        },
      ],
    }),
  });
  const data = (await res.json()) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `vision ${res.status}`);
  const text = data.content?.find((c) => c.type === "text")?.text ?? "";
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error(`no JSON in: ${text.slice(0, 120)}`);
  const v = JSON.parse(json) as Partial<Verdict>;
  return {
    storeys: typeof v.storeys === "number" ? v.storeys : null,
    confidence: typeof v.confidence === "number" ? v.confidence : 0,
    facade_visible: Boolean(v.facade_visible),
    building_type: String(v.building_type ?? "other"),
    notes: String(v.notes ?? ""),
  };
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const addresses = parseAddressBlock(fs.readFileSync(inputPath, "utf8"));
  console.log(`${addresses.length} addresses → ${outDir}/`);
  const looked = await lookupParcels(addresses);
  const rows = await mapPool(
    looked.map((l, i) => ({ ...l, n: i + 1 })),
    4,
    async ({ addr, result, point, parcelRings, n }): Promise<Row> => {
      const address = `${displayStreet(addr)}, ${addr.suburb} ${addr.state ?? ""} ${addr.postcode ?? ""}`.replace(/\s+/g, " ").trim();
      const base: Row = { n, address, status: result.status, decision: "no_image", link: null, image: null };
      if (!point) return { ...base, status: `${result.status}: no point` };
      try {
        const cam = await camera(point.lat, point.lng, latLngRingFromArcgis(parcelRings));
        base.link = streetViewUrl(point, cam ? Math.round(cam.heading * 10) / 10 : null);
        if (!cam) return { ...base, status: `${result.status}: no Street View` };
        base.camera = { lat: cam.lat, lng: cam.lng, heading: cam.heading, distanceM: cam.distanceM };
        const file = path.join(outDir, `${String(n).padStart(3, "0")}.jpg`);
        const b64 = await image(cam, file);
        base.image = file;
        const verdict = await judge(b64, address);
        const clear = verdict.storeys === 1 && verdict.confidence >= 80 && verdict.facade_visible;
        return { ...base, verdict, decision: clear ? "clear" : "check" };
      } catch (e) {
        return { ...base, status: `${result.status}: ${(e as Error).message}` };
      }
    }
  );

  const header = ["#", "Address", "Lookup", "Camera distance (m)", "Storeys (model)", "Confidence", "Facade visible", "Type", "Decision", "Notes", "Street View link", "Image"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [r.n, r.address, r.status, r.camera ? Math.round(r.camera.distanceM) : "", r.verdict?.storeys ?? "", r.verdict?.confidence ?? "", r.verdict ? (r.verdict.facade_visible ? "yes" : "no") : "", r.verdict?.building_type ?? "", r.decision, r.verdict?.notes ?? "", r.link ?? "", r.image ?? ""]
        .map(csvCell)
        .join(",")
    );
  }
  fs.writeFileSync(path.join(outDir, "storeys.csv"), `﻿${lines.join("\r\n")}\r\n`);

  const tally = { clear: 0, check: 0, no_image: 0 };
  for (const r of rows) tally[r.decision]++;
  console.log("");
  for (const r of rows) {
    const v = r.verdict;
    console.log(
      `${String(r.n).padStart(3)}  ${r.decision.padEnd(8)} ${v ? `${v.storeys ?? "?"} storey @${v.confidence}% ${v.facade_visible ? "" : "(facade hidden) "}[${v.building_type}]` : r.status}  ${r.address}`
    );
  }
  console.log(`\nclear ${tally.clear} · check ${tally.check} · no image ${tally.no_image}  →  ${path.join(outDir, "storeys.csv")}`);
}

void main();
