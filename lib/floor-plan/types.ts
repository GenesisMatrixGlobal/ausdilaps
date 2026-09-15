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
 * Anything placed ON the plan rather than being part of it — a photo-range chip ("16-28"),
 * a free note, or a "mark": the red bold number an inspector drops on a spot to key the plan
 * to the report.
 *
 * Two anchors, and which one a kind uses is a judgement about what it refers to. A chip
 * pinned to `bed-2` moves when Bedroom 2 is resized; a chip at an absolute x/y is orphaned
 * the first time anyone nudges a wall — so chips anchor to a room, and `dx`/`dy` nudge them
 * in grid units from its label anchor. A mark is the opposite case: it names a POINT, not a
 * room ("the crack, there"), so it anchors free and stays where it was put. The cost of that
 * is real and accepted — move a room afterwards and its marks do not follow.
 */
export const annotationSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["photo-range", "note", "mark"]),
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

/**
 * A run of fence along a grid line.
 *
 * Unlike a wall, this is STORED rather than derived. Walls exist wherever two rooms meet, so
 * they fall out of cell ownership for free — but a fence bounds open ground and answers to
 * nothing, so there is nothing to derive it from. Same vocabulary as WallSeg so the renderers
 * can treat it the same way.
 */
export const fenceSchema = z.object({
  id: z.string().min(1),
  orient: z.enum(["h", "v"]),
  pos: z.number(),
  from: z.number(),
  to: z.number(),
});
export type Fence = z.infer<typeof fenceSchema>;

/**
 * A wall the user has rubbed out — an open-plan edge where two rooms meet with nothing
 * between them.
 *
 * Stored as the PAIR OF ROOMS it separated, never as coordinates, for exactly the reason a
 * Door is: walls are derived from cell ownership, so a stored coordinate would go on cutting
 * a hole wherever it was written down even after the rooms moved out from under it. A pair
 * still names the right boundary, or honestly names none.
 *
 * `a` or `b` may be OUTSIDE, which is what lets an external wall be opened up — the side of
 * a carport, say.
 */
export const removedWallSchema = z.object({
  id: z.string().min(1),
  a: z.string().min(1),
  b: z.string().min(1),
});
export type RemovedWall = z.infer<typeof removedWallSchema>;

/**
 * A staircase. Stored, like a fence, because nothing derives it.
 *
 * Deliberately does NOT own grid cells: it is an overlay drawn on top of whichever room it
 * sits in, so it stays entirely outside the ownership system and cannot perturb a wall.
 * `dir` is the direction of travel the arrow points, not the direction of the treads.
 */
export const stairSchema = z.object({
  id: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  dir: z.enum(["up", "down"]).default("up"),
});
export type Stair = z.infer<typeof stairSchema>;

export const levelSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  rooms: z.array(roomSchema),
  doors: z.array(doorSchema).default([]),
  // All four defaulted, so every plan saved before each of them existed still parses.
  fences: z.array(fenceSchema).default([]),
  removedWalls: z.array(removedWallSchema).default([]),
  stairs: z.array(stairSchema).default([]),
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
