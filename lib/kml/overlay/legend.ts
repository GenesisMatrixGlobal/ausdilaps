// Shared primitives for the exported PNGs' legend panels.
//
// Both exports draw a white panel of measured text over aerial imagery, and they must look
// like one design system — same padding, row rhythm, type size and panel treatment. What they
// do NOT share is the table itself: the Measure tab's is three columns (index, figures, unit)
// while Building Markup's is four (index, street, figures, unit) plus a colour key. Forcing one
// layout function to serve both would be worse than two that share these primitives.

import { textToSvgPaths, textWidth } from "./text-path";

/** Panel padding, row pitch and type size. Changing one of these changes both exports, which
 *  is the point. */
export const PANEL_PAD = 13;
export const ROW_HEIGHT = 26;
export const ROW_SIZE = 19;
/** Number column to figures. */
export const NUM_GAP = 12;
/** Figures to their unit. Tight — "16,474" and "m²" are one reading, not two columns. */
export const UNIT_GAP = 5;
/** Breathing room above a total's hairline. */
export const TOTAL_GAP = 9;

export const INK = "23272b"; // ad-navy-deep
export const MUTED = "5b6570"; // ad-muted

export const HAIRLINE = "rgba(0,0,0,0.14)";

/**
 * The superscript-two problem.
 *
 * The glyph atlas is printable ASCII only, so "m²" would otherwise come out as "m?" — and
 * "1,234 m?" in a client-facing drawing is worse than no legend at all. Superscripting a real
 * digit is both correct and the only option that doesn't need a new atlas.
 *
 * Anything drawing formatArea() output MUST go through these two rather than textToSvgPaths /
 * textWidth directly.
 */
const SUPER_SCALE = 0.62;
const SUPER_RISE = 0.36;

export function textWithSuper(text: string, x: number, y: number, fontSize: number, fill: string): string {
  const parts: string[] = [];
  let penX = x;
  let run = "";
  const flush = () => {
    if (!run) return;
    parts.push(textToSvgPaths(run, { x: penX, y, fontSize, fill }));
    penX += textWidth(run, fontSize);
    run = "";
  };
  for (const char of text) {
    if (char === "²") {
      flush();
      const size = fontSize * SUPER_SCALE;
      parts.push(textToSvgPaths("2", { x: penX, y: y - fontSize * SUPER_RISE, fontSize: size, fill }));
      penX += textWidth("2", size);
      continue;
    }
    run += char;
  }
  flush();
  return parts.join("\n    ");
}

export function widthWithSuper(text: string, fontSize: number): number {
  let total = 0;
  for (const char of text) {
    total += char === "²" ? textWidth("2", fontSize * SUPER_SCALE) : textWidth(char, fontSize);
  }
  return total;
}

/** Splits "16,474 m²" into its figures and its unit, so the two can be aligned in separate
 *  columns — right-aligning the whole string aligns the "m²" and leaves the digits ragged,
 *  which is the wrong way round for a column of numbers. */
export function splitValue(value: string): { digits: string; unit: string } {
  const at = value.lastIndexOf(" ");
  return at < 0 ? { digits: value, unit: "" } : { digits: value.slice(0, at), unit: value.slice(at + 1) };
}

/** The panel itself. Nearly opaque with a hairline: a washier panel disappears into bright
 *  imagery (concrete, sand) exactly where a site drawing tends to be. */
export function panelRect(x: number, y: number, width: number, height: number): string {
  return `<rect x="${x}" y="${y}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="8" fill="white" fill-opacity="0.95" stroke="rgba(0,0,0,0.18)" stroke-width="1.2" />`;
}
