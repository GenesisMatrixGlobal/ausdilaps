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
  /** The quote item number, or "" for a shape that is drawn but is not a line item. Assigned
   *  client-side from the sheet's tick state, so the PNG and the screen can never disagree. */
  label: z.string().max(4).default(""),
  /** What the operator named it on the sheet — the legend uses this rather than "Shape". */
  name: z.string().max(200).default(""),
});

export type MarkupShapeInput = z.infer<typeof markupShapeSchema>;

/** Re-render request: takes the already-resolved geometry straight from the client (no
 *  geocoding or cadastre work) so unchecking a lot and regenerating is a single fast
 *  Static Maps call, not a repeat of the whole slow lookup pipeline. */
export const standardMarkupRenderRequestSchema = z.object({
  /** Empty for a multi-property markup (the *DEV* tab), which has no red project site — every
   *  lot is a blue property. `hideSubject` must be true in that case; nothing else changes. */
  subjectRing: z.array(latLngSchema),
  /** The job's own street, for the legend's project-site row. The operator typed it, so it
   *  beats anything the address layer could offer for a corner lot with several frontages. */
  subjectStreet: z.string().max(200).nullish(),
  /** The site's quote item number, or "" — it is usually drawn to show the client rather than
   *  billed, so it is normally unnumbered and absent from the legend. */
  subjectLabel: z.string().max(4).default(""),
  subjectAreaSqm: z.number().nullish(),
  neighbours: z.array(
    z.object({
      id: z.string(),
      ring: z.array(latLngSchema).min(3),
      areaSqm: z.number().nullable(),
      /** The quote item number, or "" for a lot that is drawn but is not a line item. Assigned
       *  client-side over the ticked sheet rows — see rowsFrom() in lib/markup-layers. */
      label: z.string().max(4).default(""),
      /** From the state address layer. Already sent by the client on every render and, until
       *  the legend needed them, silently stripped here. */
      street: z.string().max(200).nullish(),
      suburb: z.string().max(120).nullish(),
      /** Red for the searched address on a multi-property markup; blue is every lot before it. */
      color: z.enum(["red", "blue"]).default("blue"),
    })
  ),
  mapType: z.enum(["satellite", "hybrid", "roadmap"]).default("hybrid"),
  excludeIds: z.array(z.string()).default([]),
  /**
   * The frame to render: the live map's own viewport.
   *
   * Replaced `frame` (centre + integer fitZoom) and `zoomAdjust` when the tab moved to a live
   * Maps JS map. A live map has FRACTIONAL zoom and Static Maps takes integers only, so a box
   * is the only unambiguous way to say "render exactly what I was looking at". It also retired
   * `hideNeighbours`, `subjectAnchors` and `boundsAnchor`, which existed solely to keep a
   * pinned frame from moving under the operator.
   */
  bounds: z.object({
    south: z.number().min(-90).max(90),
    west: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
  }),
  /** Drops the cadastre-derived red project-site boundary, for when it's wrong and the
   *  operator is redrawing it as a red shape instead. The subject ring is still sent and
   *  still anchors the frame — see boundsAnchor in static-map.ts. */
  hideSubject: z.boolean().default(false),
  /** Draw every outline in the server-side SVG composite instead of as Static Maps `path`
   *  parameters. Lifts the URL-length budget (which otherwise simplifies rings and caps the
   *  lot count at 12) — for a 50-property markup. Off by default so the shipped Building
   *  Markup export is byte-for-byte what it was. */
  overlayOutlines: z.boolean().default(false),
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
  /** The job's own address, used only to look up the picked lot's street address — NSW needs
   *  the suburb to split one glued string, and QLD uses the street to choose between a corner
   *  lot's several frontages. Optional so a caller that doesn't care still works. */
  street: z.string().max(200).optional(),
  suburb: z.string().max(120).optional(),
});
