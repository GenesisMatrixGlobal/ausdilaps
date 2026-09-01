// Floor Plan tool — the shape of a plan.
//
// A plan is deliberately SCHEMATIC. The inspector's sketch carries no measurements, so
// neither does this: rooms are rectangles on a coarse integer grid, sized in proportion to
// each other and nothing more. Anything that looked like a dimension here would be invented,
// and these plans go into dilapidation reports.
//
// Geometry is DERIVED, never stored. Rooms own grid cells; walls, doorway positions and
// label anchors are all computed from cell ownership in `grid.ts`. That is what keeps a
// hand-edited plan consistent — move a room and its walls, its doors and anything pinned to
// it follow, because none of them were ever written down.

import { z } from "zod";

/** A rectangle of grid cells. x,y is the top-left cell. */
export const rectSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});
export type Rect = z.infer<typeof rectSchema>;

/** Several rects per room so an L-shaped room needs no special case anywhere else. */
export const roomSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  /**
   * "outdoor" = yard, driveway, carport, canopy, parking — drawn on the sketch but not
   * enclosed building. Rendered with a dashed boundary so the building envelope stays
   * readable: a carport bounded by solid walls reads as a room on a dilapidation plan.
   *
   * Defaulted, so plans saved before this existed still parse.
   */
  kind: z.enum(["room", "outdoor"]).default("room"),
  rects: z.array(rectSchema).min(1),
});
export type Room = z.infer<typeof roomSchema>;

export const OUTSIDE = "outside" as const;

/**
 * A door is stored as the pair of rooms it joins — never as a coordinate.
 *
 * Where it physically sits is worked out at render time from the wall the two rooms share.
 * Store a cell instead and the door is silently wrong the moment someone drags a wall; this
 * way it either follows the rooms or (if they stop touching) drops out and can be flagged.
 */
export const doorSchema = z.object({
  id: z.string().min(1),
  a: z.string().min(1),
  b: z.string().min(1),
  kind: z.enum(["swing", "opening"]),
  /** Which room the arc opens into. */
  swingInto: z.enum(["a", "b"]).default("b"),
  /**
   * Where along the shared wall the opening starts, in grid units.
   *
   * Left unset the door centres itself on the longest stretch of shared wall, which is the
   * right answer until someone says otherwise. Dragging a door sets it. If the rooms later
   * move so this no longer lands on shared wall, placement falls back to centring rather
   * than dropping the door.
   */
  at: z.number().optional(),
  /** Which end of the opening the leaf is hinged at. */
  hinge: z.enum(["start", "end"]).default("start"),
  /** "inferred" = not actually drawn on the sketch. Rendered lighter, listed for checking. */
  confidence: z.enum(["visible", "inferred"]).default("visible"),
});
export type Door = z.infer<typeof doorSchema>;

/**
 * Anything placed ON the plan rather than being part of it — today a photo-range chip
 * ("16-28") or a free note.
 *
 * Anchoring to a room, not to a coordinate, is the whole point. A chip pinned to `bed-2`
 * moves when Bedroom 2 is resized; a chip at an absolute x/y is orphaned the first time
 * anyone nudges a wall. `dx`/`dy` are a nudge in grid units from the room's label anchor.
 */
export const annotationSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["photo-range", "note"]),
  text: z.string(),
  anchor: z.discriminatedUnion("type", [
    z.object({ type: z.literal("room"), roomId: z.string().min(1), dx: z.number(), dy: z.number() }),
    z.object({ type: z.literal("free"), x: z.number(), y: z.number() }),
  ]),
  /** Where the value came from, so a re-sync can update in place instead of duplicating. */
  source: z
    .object({ system: z.literal("salesforce"), object: z.string(), recordId: z.string() })
    .optional(),
  /** "auto" = placed by name matching and not yet confirmed by a human. Rendered dashed. */
  placement: z.enum(["manual", "auto"]).default("manual"),
});
export type Annotation = z.infer<typeof annotationSchema>;

export const levelSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  rooms: z.array(roomSchema),
  doors: z.array(doorSchema).default([]),
  annotations: z.array(annotationSchema).default([]),
});
export type Level = z.infer<typeof levelSchema>;

export const floorPlanSchema = z.object({
  address: z.string(),
  suburb: z.string(),
  /** Cells across and down. Chosen to roughly match the building's proportions. */
  grid: z.object({ w: z.number().int().min(2).max(80), h: z.number().int().min(2).max(80) }),
  /** Which way north points ON THE PAGE. 0 = up, 90 = right, 180 = down, 270 = left. */
  north: z.number().int().min(0).max(359),
  /** What the compass on the sketch actually showed. Kept so north can be checked, not trusted. */
  northNote: z.string().default(""),
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
  levels: z.array(levelSchema).min(1),
});
export type FloorPlan = z.infer<typeof floorPlanSchema>;

export const A4_MM = { w: 210, h: 297 } as const;

/** A4 pixel size at a given DPI. 300 → 2480x3508 portrait. */
export function a4Pixels(dpi: number, orientation: "portrait" | "landscape") {
  const long = Math.round((A4_MM.h / 25.4) * dpi);
  const short = Math.round((A4_MM.w / 25.4) * dpi);
  return orientation === "portrait" ? { w: short, h: long } : { w: long, h: short };
}
