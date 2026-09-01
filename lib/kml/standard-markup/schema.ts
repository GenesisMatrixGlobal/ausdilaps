import { z } from "zod";

export const standardMarkupRequestSchema = z.object({
  street: z.string().trim().min(1, "Street address is required").max(200),
  suburb: z.string().trim().min(1, "Suburb is required").max(200),
  postcode: z.string().trim().max(10).optional(),
  state: z.enum(["QLD", "NSW", "VIC"]),
  mapType: z.enum(["satellite", "hybrid", "roadmap"]).default("hybrid"),
  /** Adjusts the auto-computed tight-fit zoom — negative zooms out for more context, positive zooms in tighter. */
  zoomAdjust: z.number().int().min(-3).max(3).default(0),
});

export type StandardMarkupRequest = z.infer<typeof standardMarkupRequestSchema>;

const latLngSchema = z.object({ lat: z.number(), lng: z.number() });

export const MARKUP_SHAPE_COLORS = ["orange", "blue", "red"] as const;

const markupShapeSchema = z.object({
  points: z.array(latLngSchema).min(2).max(20),
  /** Ignored in "area" mode — kept required so the field never needs a null branch. */
  widthMetres: z.number().min(5).max(30),
  mode: z.enum(["line", "area"]).default("line"),
  color: z.enum(MARKUP_SHAPE_COLORS).default("orange"),
});

export type MarkupShapeInput = z.infer<typeof markupShapeSchema>;

/** Re-render request: takes the already-resolved geometry straight from the client (no
 *  geocoding or cadastre work) so unchecking a lot and regenerating is a single fast
 *  Static Maps call, not a repeat of the whole slow lookup pipeline. */
export const standardMarkupRenderRequestSchema = z.object({
  subjectRing: z.array(latLngSchema).min(3),
  neighbours: z.array(
    z.object({
      id: z.string(),
      ring: z.array(latLngSchema).min(3),
      areaSqm: z.number().nullable(),
      label: z.string(),
    })
  ),
  mapType: z.enum(["satellite", "hybrid", "roadmap"]).default("hybrid"),
  zoomAdjust: z.number().int().min(-3).max(3).default(0),
  excludeIds: z.array(z.string()).default([]),
  /** The frame captured from the first Generate. Present on every re-render so the photo
   *  is pinned: unticking a lot, drawing a shape or adding a lot can no longer refit the
   *  bounds and shift the map under the operator. `zoomAdjust` still applies on top, so
   *  the Zoom control is the only thing that moves it. Optional — without it the renderer
   *  fits to the geometry as it always did. */
  frame: z
    .object({ center: latLngSchema, fitZoom: z.number().int().min(1).max(20) })
    .optional(),
  /** Drops the blue neighbouring-lot fills while keeping them as frame anchors — the
   *  on-screen preview, whose overlay draws them itself. */
  hideNeighbours: z.boolean().default(false),
  /** Drops the cadastre-derived red project-site boundary, for when it's wrong and the
   *  operator is redrawing it as a red shape instead. The subject ring is still sent and
   *  still anchors the frame — see boundsAnchor in static-map.ts. */
  hideSubject: z.boolean().default(false),
  /** User-drawn shapes — council assets, external areas, adjacent buildings, anything
   *  the automatic lot detection can't produce. A list, not a single one, since a
   *  property can need several unrelated ones. Capped at 5 per property.
   *
   *  `mode` decides how the points become a polygon: "line" centres a ribbon
   *  `widthMetres` wide on them (a frontage, a footpath), "area" treats them as the
   *  boundary itself and infills what they enclose (a reserve, a building footprint).
   *
   *  `color` maps the shape onto one of the legend's two existing categories rather than
   *  being a free colour choice — "orange" is Council / External Assets, "blue" is
   *  Neighbouring Assets. That keeps the exported legend at three fixed rows.
   *
   *  Both default, so a client bundle posting an older payload still validates. A
   *  payload carrying the removed `side` field is fine too — zod strips unknown keys. */
  shapes: z.array(markupShapeSchema).max(5).default([]),
  /** @deprecated Pre-rename name for `shapes`. Still accepted so a tab that was already
   *  open when the rename shipped doesn't 400 and lose the operator's drawing. Read only
   *  when `shapes` is empty — see the render route. */
  councilAssets: z.array(markupShapeSchema).max(5).default([]),
});

export type StandardMarkupRenderRequest = z.infer<typeof standardMarkupRenderRequestSchema>;

/** Cadastre lookup for a single parcel under a clicked point — the "Detect lot boundary"
 *  button. Deliberately separate from the address pipeline: no geocoding, just an
 *  envelope query around the point and a point-in-polygon pick. */
export const parcelAtPointRequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  state: z.enum(["QLD", "NSW", "VIC"]),
});
