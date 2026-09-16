// How a cover photo renders. The single source of truth for both the live map and the
// server-side export, so the two can never drift on colour, opacity or weight.
//
// Deliberately SEPARATE from lib/kml/standard-markup/style.ts rather than adding a "green"
// to it. That module's colours are wired into two zod enums, the exported legend's
// colourKeys() and the GENERATED glyph atlas in overlay-paths.ts — a new colour there costs
// four coordinated changes plus regenerating the atlas against local macOS Arial Bold
// (Vercel's runtime has no fonts, so <text> renders blank). A cover photo has no legend and
// one colour, so it needs none of that.
//
// Dependency-free: the client imports it too.

/** The report template's image BOX, in template points. Not the output size — see
 *  COVER_OUTPUT_SCALE. Change these two and everything downstream (the map's on-screen
 *  aspect, the export framing, the final resize) follows. */
export const COVER_BOX_WIDTH = 600;
export const COVER_BOX_HEIGHT = 442;

/** Rendered at 2x the box so the image is still sharp when the report is printed rather than
 *  read on screen. It costs nothing extra at Google's end — the frame is already fetched at
 *  ~2400px and downscaled, so this just throws away less of it. */
export const COVER_OUTPUT_SCALE = 2;

export const COVER_WIDTH_PX = COVER_BOX_WIDTH * COVER_OUTPUT_SCALE;
export const COVER_HEIGHT_PX = COVER_BOX_HEIGHT * COVER_OUTPUT_SCALE;

/** Width / height. The frame is planned to this ratio so the final resize is 1:1 rather
 *  than a hidden stretch. Scale-independent, so doubling the output cannot change framing. */
export const COVER_ASPECT = COVER_BOX_WIDTH / COVER_BOX_HEIGHT;

/** 6-digit hex, no leading '#': the form buildStaticMapUrl wants. Maps JS wants a '#', and
 *  the map component prefixes it — one constant, two consumers, no second copy to drift. */
export const COVER_GREEN = "16a34a";

/** Heavier than the markup's OUTLINE_WEIGHT of 2. There is exactly one shape on a cover
 *  photo and it is the point of the image, so it reads at report-print size. Expressed in
 *  the same logical (pre-`scale`) pixel space Static Maps' `size` describes. */
export const COVER_OUTLINE_WEIGHT = 3;

/** Dark enough to read at a glance on a busy aerial, light enough that the roof, driveway and
 *  boundary features stay visible through it — a cover photo is a photograph of the property
 *  first and a diagram second. Raised from 28% with a darker green (Rhys, 2026-09-16) after
 *  looking at real exports: the lighter fill washed out over pale roofs and concrete. */
export const COVER_FILL_OPACITY_PERCENT = 38;
export const COVER_STROKE_OPACITY_PERCENT = 100;

/**
 * A dark scrim over everything OUTSIDE the boundary, so the property reads first.
 *
 * Dimming the surroundings rather than the whole image is what actually makes the shape pop —
 * a uniform scrim knocks the green back by exactly as much as everything else. The property
 * itself is left at full brightness.
 *
 * ⚠️ Google's attribution band along the bottom is EXCLUDED from the scrim: the Maps Platform
 * terms forbid obscuring it, and a translucent layer over it is still obscuring it.
 *
 * SET THIS TO 0 TO TURN THE WHOLE EFFECT OFF — the renderer skips the layer entirely and
 * nothing else changes. That is the whole undo.
 */
export const COVER_DIM_OUTSIDE_PERCENT = 22;
