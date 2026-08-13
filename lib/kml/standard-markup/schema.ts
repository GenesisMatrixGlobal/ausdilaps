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
