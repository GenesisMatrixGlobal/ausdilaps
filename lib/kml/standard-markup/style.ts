// The single source of truth for how a markup renders — shared by the server renderer
// (render-image.ts) and the live on-screen overlay (components/tools/site-markups/
// markup-canvas.tsx).
//
// It exists because those two used to keep their own copies of these values, with a
// "mirrors the other one" comment holding them together. They drifted: the overlay drew
// outlines at 3-6 units against the exported image's 2, so the preview never quite
// matched the file. Deliberately dependency-free so the client can import it — the
// renderer itself pulls in sharp and can't cross that line.

/** Every outline, on every shape, in both the preview and the export. One weight, no
 *  exceptions — the Project Site reads as the site because it's red, not because it's
 *  thicker. Expressed in the 500-unit coordinate space Static Maps' `size` describes,
 *  which is also the overlay SVG's viewBox, so the same number means the same thing on
 *  both sides. */
export const OUTLINE_WEIGHT = 2;

/** 6-digit hex, no leading '#': that's the form buildStaticMapUrl wants. The overlay
 *  prefixes '#' itself. */
export const SITE_RED = "ff0000";
export const NEIGHBOUR_FILL = "1d4ed8";

/** A shape's colour picks one of the exported legend's three existing rows rather than
 *  being a free choice, which is what keeps that legend fixed however many shapes get
 *  drawn. Blue deliberately shares the neighbouring-lot blue: a hand-drawn adjacent
 *  building IS a neighbouring asset. Red shares SITE_RED for the same reason — untick the
 *  detected project site and redraw it in red, and it is the same red by construction
 *  rather than a second hardcoded value that could drift. */
export const SHAPE_COLORS = { orange: "e8642a", blue: NEIGHBOUR_FILL, red: SITE_RED } as const;

export type ShapeColorKey = keyof typeof SHAPE_COLORS;

export const FILL_OPACITY_PERCENT = 50;
export const STROKE_OPACITY_PERCENT = 90;
/** The site fill is the one thing drawn at full stroke opacity. */
export const SITE_STROKE_OPACITY_PERCENT = 100;
