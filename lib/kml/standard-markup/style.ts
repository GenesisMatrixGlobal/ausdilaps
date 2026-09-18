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
 *  both sides.
 *
 *  Widened from 2 to 4 on 2026-09-16 at Rhys's request — an outline needs to stand out a
 *  little more, and it is doing real work now that a part-inspected property is told apart
 *  from a finished one by its EDGE colour. ⚠️ This is the shared constant, so it thickened
 *  Building Markup's and Measure's exports too; that was the ask ("the outline on
 *  everything"), and a per-tool weight would break the one-weight rule above. */
export const OUTLINE_WEIGHT = 4;

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

/** Inspected green, for the Closeout Markup — a lot there is coloured by how its work orders
 *  went, not by whether it is the project site. */
export const INSPECTED_GREEN = "16a34a";

export const FILL_OPACITY_PERCENT = 50;
export const STROKE_OPACITY_PERCENT = 90;
/** The site fill is the one thing drawn at full stroke opacity. */
export const SITE_STROKE_OPACITY_PERCENT = 100;

/**
 * How a LOT is drawn: an outline colour and a fill colour.
 *
 * A pair rather than one hex, because "partly inspected" is a GREEN FILL with an ORANGE
 * OUTLINE rather than a fifth colour in the palette. That was Rhys's call over a purple, and
 * it is the better one: it adds no new colour to a drawing a client sees.
 *
 * ⚠️ Green INSIDE, orange OUTSIDE — inverted on 2026-09-16 after looking at a real drawing.
 * The fill is most of what the eye reads, so an orange body made a part-done building look
 * like nothing had happened there. Green body with an orange edge reads as what it is: mostly
 * done, something outstanding.
 *
 * ⚠️ Solid fill, NOT stripes. `google.maps.Polygon` takes a single `fillColor` and cannot
 * render a pattern, so a striped export would not match the live map — and preview/export
 * parity is the standing hazard in this pipeline. Everything drawn here has to be something
 * both renderers can do.
 *
 * Every other key is the same colour twice, so a caller can always read `.stroke` for "the
 * colour of this thing" (badges, swatches) without a special case.
 */
export const MARKUP_STYLES = {
  red: { stroke: SITE_RED, fill: SITE_RED, fillOpacity: FILL_OPACITY_PERCENT },
  blue: { stroke: NEIGHBOUR_FILL, fill: NEIGHBOUR_FILL, fillOpacity: FILL_OPACITY_PERCENT },
  orange: { stroke: SHAPE_COLORS.orange, fill: SHAPE_COLORS.orange, fillOpacity: FILL_OPACITY_PERCENT },
  green: { stroke: INSPECTED_GREEN, fill: INSPECTED_GREEN, fillOpacity: FILL_OPACITY_PERCENT },
  partial: { stroke: SHAPE_COLORS.orange, fill: INSPECTED_GREEN, fillOpacity: FILL_OPACITY_PERCENT },
  /**
   * The project site on a CLOSEOUT markup: a red outline and NO fill.
   *
   * ⚠️ It cannot be plain `red`, which on a closeout already means "closed, not inspected" —
   * two rows of the colour key would carry an identical red dot meaning different things
   * (Rhys, 2026-09-18, choosing this over Building Markup's solid red). Unfilled is the right
   * distinction rather than an arbitrary one: the site is the WORKS, not a property that was or
   * wasn't inspected, so it carries no status fill — and the imagery showing through is what
   * makes it read as an extent rather than a subject.
   *
   * ⚠️ NOT dashed, which would have been the other obvious answer: `google.maps.Polygon` can
   * only dash a stroke via a Polyline's `icons`, so the live map could not match the export.
   * Same reason MARKUP_STYLES has no stripes.
   */
  site: { stroke: SITE_RED, fill: SITE_RED, fillOpacity: 0 },
} as const;

export type MarkupColorKey = keyof typeof MARKUP_STYLES;

export const MARKUP_COLOR_KEYS = Object.keys(MARKUP_STYLES) as [
  MarkupColorKey,
  ...MarkupColorKey[],
];

/**
 * The one colour that stands for a key, for a badge or anywhere only one is available.
 *
 * The FILL, not the outline: the fill is what the eye reads as "the colour of this thing", and
 * for `partial` the outline is the orange flag rather than the identity. A teardrop over a
 * part-inspected property is therefore green, matching the lot under it.
 */
export function markupColor(key: MarkupColorKey | undefined): string {
  return MARKUP_STYLES[key ?? "blue"]?.fill ?? NEIGHBOUR_FILL;
}


