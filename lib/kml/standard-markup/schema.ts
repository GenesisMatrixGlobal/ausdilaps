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
  /** Drops the numbered neighbour pins — used for the client-facing download. */
  hideMarkers: z.boolean().default(false),
  /** User-drawn council-asset lines (click-to-place points + a width in metres each) —
   *  a list, not a single line, since a property can need two disconnected assets (e.g.
   *  a front road frontage and an unrelated rear laneway). Capped at 5 per property. */
  councilAssets: z
    .array(
      z.object({
        points: z.array(latLngSchema).min(2).max(10),
        widthMetres: z.number().min(5).max(20),
      })
    )
    .max(5)
    .default([]),
});

export type StandardMarkupRenderRequest = z.infer<typeof standardMarkupRenderRequestSchema>;
