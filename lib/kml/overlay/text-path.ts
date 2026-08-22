// Composes arbitrary text into SVG <path> geometry using the outlined glyph atlas, so
// overlay labels render identically on Vercel (no fonts installed) and locally.
//
// One <path> per character, each translated to its pen position and scaled from the
// atlas's reference size. Kerning pairs are not applied — the atlas stores per-glyph
// advances only — which is imperceptible at label sizes and keeps this dependency-free.

import { CAP_HEIGHT, GLYPHS, GLYPH_UNITS } from "./glyph-atlas";

/** Stand-in for anything outside the atlas's printable-ASCII range (e.g. an en dash or an
 *  accented character in a road name), so a dropped character is visible rather than silent. */
const FALLBACK_CHAR = "?";

function glyphFor(char: string) {
  return GLYPHS[char] ?? GLYPHS[FALLBACK_CHAR];
}

/** Width the text will occupy when rendered at `fontSize`. */
export function textWidth(text: string, fontSize: number): number {
  const scale = fontSize / GLYPH_UNITS;
  let total = 0;
  for (const char of text) {
    const glyph = glyphFor(char);
    if (glyph) total += glyph.advance;
  }
  return total * scale;
}

export interface TextPathOptions {
  /** Left edge of the text. */
  x: number;
  /** Baseline, matching SVG <text> y semantics. */
  y: number;
  fontSize: number;
  /** Hex colour without the leading '#'. */
  fill: string;
}

/** Renders `text` as a run of <path> elements. Returns "" for empty text. */
export function textToSvgPaths(text: string, opts: TextPathOptions): string {
  const scale = opts.fontSize / GLYPH_UNITS;
  const parts: string[] = [];
  let penX = opts.x;

  for (const char of text) {
    const glyph = glyphFor(char);
    if (!glyph) continue;
    // Transforms apply right-to-left to the geometry: scale the glyph to size first, then
    // move it to the pen position.
    if (glyph.d) {
      parts.push(
        `<path transform="translate(${penX.toFixed(2)}, ${opts.y.toFixed(2)}) scale(${scale.toFixed(5)})" d="${glyph.d}" fill="#${opts.fill}" />`
      );
    }
    penX += glyph.advance * scale;
  }

  return parts.join("\n    ");
}

export interface CentredTextOptions {
  /** Horizontal centre of the text. */
  cx: number;
  /** Vertical centre of the text's capital-letter height. */
  cy: number;
  fontSize: number;
  fill: string;
}

/**
 * Renders `text` centred on a point, for labels that sit inside a shape (the compass "N").
 * Centres on cap height rather than a measured bounding box, which is what visually
 * balances capitals and needs no path parsing at runtime.
 */
export function textToSvgPathsCentred(text: string, opts: CentredTextOptions): string {
  const capHeight = (CAP_HEIGHT * opts.fontSize) / GLYPH_UNITS;
  return textToSvgPaths(text, {
    x: opts.cx - textWidth(text, opts.fontSize) / 2,
    y: opts.cy + capHeight / 2,
    fontSize: opts.fontSize,
    fill: opts.fill,
  });
}
