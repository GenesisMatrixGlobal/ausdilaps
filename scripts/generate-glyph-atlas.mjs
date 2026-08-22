/**
 * Regenerates lib/kml/overlay/glyph-atlas.ts.
 *
 * Why an atlas: map overlays are composited onto the Static Maps PNG by sharp, which
 * renders SVG text through librsvg/fontconfig — and Vercel's serverless runtime ships with
 * no fonts, so every <text> element comes out blank in production while working fine
 * locally on macOS. Outlining the glyphs removes the font dependency at runtime.
 *
 * The Residential Mark Up overlay solves this by outlining its four fixed strings whole
 * (see generate-overlay-paths.mjs). Road Markup can't: the road name is user input and the
 * traced length changes per request. So instead we outline each character once, record its
 * advance width, and compose arbitrary strings from those pieces at runtime.
 *
 * Glyphs are generated at GLYPH_UNITS and scaled at use time, so one atlas serves every
 * font size. Only run this when the character set changes. Requires a local Arial Bold
 * (macOS); only the outline geometry is committed, never the font itself.
 *
 *   node scripts/generate-glyph-atlas.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import opentype from "opentype.js";

const FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Bold.ttf";
const OUT_PATH = "lib/kml/overlay/glyph-atlas.ts";

// Generated at this size, then scaled by (fontSize / GLYPH_UNITS) at use time. Large
// enough that rounding path coordinates to 2dp stays smooth at any display size.
const GLYPH_UNITS = 100;

// Printable ASCII. Covers road names (letters, digits, spaces, hyphens, apostrophes,
// full stops, slashes) plus anything the length label needs, with room to spare.
const FIRST_CHAR = 32;
const LAST_CHAR = 126;

const font = opentype.parse(new Uint8Array(readFileSync(FONT_PATH)).buffer);

const entries = [];
for (let code = FIRST_CHAR; code <= LAST_CHAR; code++) {
  const char = String.fromCharCode(code);
  const advance = font.getAdvanceWidth(char, GLYPH_UNITS);
  // Space and other blanks produce no geometry — keep the advance, drop the path.
  const d = font.getPath(char, 0, 0, GLYPH_UNITS).toPathData(2);
  entries.push(
    `  ${JSON.stringify(char)}: { d: ${JSON.stringify(d)}, advance: ${Number(advance.toFixed(3))} },`
  );
}

// Cap height lets callers centre capital letters vertically (the compass "N") without
// measuring a path bounding box at runtime.
const capHeight = (font.tables.os2.sCapHeight / font.unitsPerEm) * GLYPH_UNITS;

const out = `// GENERATED FILE — do not edit by hand.
// Regenerate with: node scripts/generate-glyph-atlas.mjs
//
// Outlined glyph geometry for composing arbitrary text into map overlays. See the
// generator script for why overlay text is paths rather than SVG <text>: Vercel's
// serverless runtime has no fonts installed, so sharp renders <text> blank in production.

export interface Glyph {
  /** Outline path data, baseline on the origin, left edge at x=0. */
  d: string;
  /** Pen advance to the next glyph's origin, in the same units. */
  advance: number;
}

/** Font size the outlines were generated at. Scale by (fontSize / GLYPH_UNITS) to use. */
export const GLYPH_UNITS = ${GLYPH_UNITS};

/** Height of a capital letter above the baseline, in atlas units. */
export const CAP_HEIGHT = ${Number(capHeight.toFixed(3))};

export const GLYPHS: Record<string, Glyph> = {
${entries.join("\n")}
};
`;

mkdirSync("lib/kml/overlay", { recursive: true });
writeFileSync(OUT_PATH, out);
console.log(`Wrote ${OUT_PATH}`);
console.log(`  ${entries.length} glyphs @ ${GLYPH_UNITS} units`);
