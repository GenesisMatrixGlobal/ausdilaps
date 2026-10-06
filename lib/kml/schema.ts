import { z } from "zod";

export const latLngSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export const kmlPathSchema = z.object({
  name: z.string().trim().min(1, "Give this path a label"),
  coordinates: z.array(latLngSchema).min(2, "A path needs at least 2 points"),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const kmlRequestSchema = z.object({
  documentName: z.string().trim().optional().default("AusDilaps Survey Paths"),
  paths: z.array(kmlPathSchema).min(1, "Add at least one path").max(500),
});
