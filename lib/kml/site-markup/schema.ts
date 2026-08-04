import { z } from "zod";

export const siteMarkupRequestSchema = z.object({
  roadName: z.string().trim().min(1, "Road name is required").max(200),
  fromDesc: z.string().trim().min(1, "From cross street is required").max(200),
  toDesc: z.string().trim().min(1, "To cross street is required").max(200),
  area: z.string().trim().min(1, "Suburb/postcode is required").max(200),
  color: z
    .string()
    .trim()
    .regex(/^#?[0-9a-fA-F]{6}$/, "Colour must be a 6-digit hex value")
    .transform((v) => v.replace(/^#/, "").toLowerCase())
    .default("ffeb00"),
  opacityPercent: z.number().min(10).max(95).default(55),
  mapType: z.enum(["satellite", "hybrid", "roadmap"]).default("hybrid"),
  /** Adjusts the auto-computed tight-fit zoom — negative zooms out for more context, positive zooms in tighter. */
  zoomAdjust: z.number().int().min(-3).max(3).default(0),
});

export type SiteMarkupRequest = z.infer<typeof siteMarkupRequestSchema>;
