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

/** The report template's image box. Change these two numbers and everything downstream —
 *  the map's on-screen aspect, the export framing and the final resize — follows. */
export const COVER_WIDTH_PX = 600;
export const COVER_HEIGHT_PX = 442;

/** Width / height. The frame is planned to this ratio so the final resize is 1:1 rather
 *  than a hidden stretch. */
export const COVER_ASPECT = COVER_WIDTH_PX / COVER_HEIGHT_PX;

/** 6-digit hex, no leading '#': the form buildStaticMapUrl wants. Maps JS wants a '#', and
 *  the map component prefixes it — one constant, two consumers, no second copy to drift. */
export const COVER_GREEN = "22c55e";

/** Heavier than the markup's OUTLINE_WEIGHT of 2. There is exactly one shape on a cover
 *  photo and it is the point of the image, so it reads at report-print size. Expressed in
 *  the same logical (pre-`scale`) pixel space Static Maps' `size` describes. */
export const COVER_OUTLINE_WEIGHT = 3;

/** Light enough that the roof, driveway and boundary features stay readable through it —
 *  a cover photo is a photograph of the property first and a diagram second. */
export const COVER_FILL_OPACITY_PERCENT = 28;
export const COVER_STROKE_OPACITY_PERCENT = 100;
