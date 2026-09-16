// Floor Plan — run the real extractor over a list of images and print what came back.
//
//   npx tsx scripts/check-floor-plan.ts ~/Downloads/*.jpg
//   npx tsx scripts/check-floor-plan.ts --json out/ ~/Downloads/plan.png
//
// Why this exists: every extraction change so far has been judged by uploading a photo
// through the browser and squinting at the result, which is why ~/Downloads accumulated
// files called "fail 1 - ...", "fail 2 - ...". That tells you a plan came out wrong; it does
// not tell you WHICH of north, rooms, levels or labels moved when you changed the prompt.
//
// One line per image, so a prompt change can be judged against the whole corpus in one run
// and a regression somewhere else is visible rather than discovered later.
//
// This costs real money — a plan is single-digit-to-~25c — and records usage like any other
// call, so it is a deliberate command and not part of typecheck/lint/build.

import { config } from "dotenv";

config({ path: ".env.local" });

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import sharp from "sharp";
import { buildOwnerGrid, validateLevel } from "@/lib/floor-plan/grid";
import { extractFloorPlan, visionConfigured } from "@/lib/floor-plan/extract";
import type { FloorPlan } from "@/lib/floor-plan/types";

const MEDIA: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function summarise(plan: FloorPlan): string[] {
  const out: string[] = [];
  out.push(`  address  ${JSON.stringify(plan.address)}   suburb ${JSON.stringify(plan.suburb)}`);
  out.push(`  grid     ${plan.grid.w}x${plan.grid.h}   north ${plan.north}deg`);
  if (plan.northNote) out.push(`  north?   ${plan.northNote}`);

  for (const level of plan.levels) {
    out.push(`  level    "${level.name}" — ${level.rooms.length} rooms, ${level.doors.length} doors`);
    out.push(
      `           ${level.rooms.map((r) => r.label + (r.kind === "outdoor" ? "*" : "")).join(", ")}`
    );
    // Overlaps and interior holes are silent in the drawing but wreck the geometry, so they
    // matter more than the room count when judging one prompt against another.
    for (const issue of validateLevel(level, plan.grid)) out.push(`           ! ${issue.detail}`);
    const cells = buildOwnerGrid(level.rooms, plan.grid).flat().filter(Boolean).length;
    out.push(`           ${cells} of ${plan.grid.w * plan.grid.h} cells owned`);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  let jsonDir: string | null = null;
  const jsonAt = args.indexOf("--json");
  if (jsonAt !== -1) {
    jsonDir = args[jsonAt + 1];
    args.splice(jsonAt, 2);
  }

  if (args.length === 0) {
    console.error("usage: npx tsx scripts/check-floor-plan.ts [--json <dir>] <image>...");
    process.exit(2);
  }
  if (!visionConfigured()) {
    console.error("No ANTHROPIC_API_KEY — put one in .env.local.");
    process.exit(2);
  }
  if (jsonDir) mkdirSync(jsonDir, { recursive: true });

  let failed = 0;
  for (const file of args) {
    const ext = extname(file).toLowerCase();
    const mediaType = MEDIA[ext];
    if (!mediaType) {
      console.log(`${basename(file)}\n  skipped — ${ext || "no extension"} is not an image\n`);
      continue;
    }

    const bytes = readFileSync(file);
    const meta = await sharp(bytes).metadata();
    const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    console.log(`${basename(file)}`);
    console.log(
      `  ${(bytes.length / 1024).toFixed(0)}KB ${mediaType} ${meta.width}x${meta.height}` +
        // extract.ts records that detail stops being legible below this; a printed plan has
        // finer text than the hand sketch that number was measured on.
        (longEdge < 1568 ? `  << under the 1568px legibility floor` : "")
    );

    const started = Date.now();
    try {
      const plan = await extractFloorPlan(bytes.toString("base64"), mediaType);
      console.log(`  ${((Date.now() - started) / 1000).toFixed(0)}s`);
      for (const line of summarise(plan)) console.log(line);
      if (jsonDir) {
        const out = join(jsonDir, `${basename(file, ext)}.json`);
        writeFileSync(out, JSON.stringify(plan, null, 2));
        console.log(`  saved    ${out}`);
      }
    } catch (err) {
      failed++;
      console.log(`  ${((Date.now() - started) / 1000).toFixed(0)}s`);
      console.log(`  FAILED   ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log("");
  }

  process.exit(failed > 0 ? 1 : 0);
}

void main();
