/**
 * Regenerates lib/kml/standard-markup/overlay-paths.ts.
 *
 * Why this exists: the markup overlay (legend + north arrow) is an SVG composited onto
 * the Static Maps PNG by sharp. sharp renders SVG text through librsvg/fontconfig, which
 * needs a real font installed on the machine. Vercel's serverless runtime ships with no
 * fonts, so every <text> element rendered blank in production while working fine locally
 * on macOS. Converting the handful of fixed strings to outlined <path> geometry removes
 * the font dependency entirely — the glyphs become plain vector shapes.
 *
 * Only run this when the legend copy changes. Requires a local Arial Bold (macOS).
 *
 *   node scripts/generate-overlay-paths.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import opentype from "opentype.js";

const FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Bold.ttf";
const OUT_PATH = "lib/kml/standard-markup/overlay-paths.ts";

// Must match the font-size values the old <text> elements used, so the rendered
// output is pixel-identical to the pre-fix version.
const LEGEND_FONT_SIZE = 18;
const COMPASS_FONT_SIZE = 20;

const LEGEND_LABELS = ["Project Site", "Neighbouring Assets", "Council Assets"];
const COMPASS_LABEL = "N";

const font = opentype.parse(
  new Uint8Array(readFileSync(FONT_PATH)).buffer
);

/** Left-aligned on the origin, sitting on the baseline — matches SVG <text> default. */
function baselinePath(text, fontSize) {
  return font.getPath(text, 0, 0, fontSize).toPathData(2);
}

/** Centred on the origin both axes — replaces text-anchor=middle + dominant-baseline=middle,
 *  which librsvg handles inconsistently even when a font *is* present. */
function centredPath(text, fontSize) {
  const path = font.getPath(text, 0, 0, fontSize);
  const { x1, y1, x2, y2 } = path.getBoundingBox();
  const dx = -(x1 + x2) / 2;
  const dy = -(y1 + y2) / 2;
  return font.getPath(text, dx, dy, fontSize).toPathData(2);
}

const legendEntries = LEGEND_LABELS.map(
  (label) => `  ${JSON.stringify(label)}: ${JSON.stringify(baselinePath(label, LEGEND_FONT_SIZE))},`
).join("\n");

const out = `// GENERATED FILE — do not edit by hand.
// Regenerate with: node scripts/generate-overlay-paths.mjs
//
// Outlined glyph geometry for the markup overlay's fixed strings. See the generator
// script for why these are paths rather than SVG <text>: Vercel's serverless runtime has
// no fonts installed, so sharp renders <text> blank in production.

/** Legend labels, left-aligned with the baseline on the origin. */
export const LEGEND_LABEL_PATHS: Record<string, string> = {
${legendEntries}
};

/** The compass "N", centred on the origin both axes. */
export const COMPASS_N_PATH =
  ${JSON.stringify(centredPath(COMPASS_LABEL, COMPASS_FONT_SIZE))};
`;

writeFileSync(OUT_PATH, out);
console.log(`Wrote ${OUT_PATH}`);
console.log(`  ${LEGEND_LABELS.length} legend labels @ ${LEGEND_FONT_SIZE}px`);
console.log(`  compass "N" @ ${COMPASS_FONT_SIZE}px`);
