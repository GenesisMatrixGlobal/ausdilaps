import { z } from "zod";

const latLngSchema = z.object({ lat: z.number(), lng: z.number() });

/** Points an operator may place by hand. The cadastre rings the tool draws automatically are
 *  often far denser than this — hence the much larger cap on the render schema below. The two
 *  are different limits on purpose, not the usual "keep these in step" pair. */
export const MAX_DRAWN_POINTS = 100;

/**
 * A ring on the wire. Generous, because a state cadastre parcel is routinely a few hundred
 * vertices and there is nothing to fit it into: the outline is composited as SVG, not encoded
 * into a Static Maps URL, so the URL-length budget that caps the markup export does not apply.
 */
const ringSchema = z.array(latLngSchema).min(3).max(2000);

export const coverParcelRequestSchema = z.object({
  street: z.string().trim().min(1, "Street address is required").max(200),
  suburb: z.string().trim().min(1, "Suburb is required").max(200),
  postcode: z.string().trim().max(10).optional(),
  /** The three states with a cadastre adapter. Everywhere else the tool still works — the
   *  operator draws the area by hand — so the client only calls this route for these. */
  state: z.enum(["QLD", "NSW", "VIC"]),
});

export const coverRenderRequestSchema = z.object({
  ring: ringSchema,
  /** The live map's viewport. Bounds rather than centre+zoom: the map's zoom is fractional
   *  and Static Maps takes integers only, so rounding would move the frame. */
  bounds: z.object({
    south: z.number().min(-90).max(90),
    west: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
  }),
  mapType: z.enum(["satellite", "hybrid", "roadmap"]).default("hybrid"),
});

export type CoverParcelRequest = z.infer<typeof coverParcelRequestSchema>;
export type CoverRenderRequest = z.infer<typeof coverRenderRequestSchema>;
