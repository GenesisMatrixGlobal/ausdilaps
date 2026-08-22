import { z } from "zod";

/** Rendering options — identical in both input modes, since only the way the road path is
 *  resolved differs, never the way it's drawn. */
const renderFields = {
  color: z
    .string()
    .trim()
    .regex(/^#?[0-9a-fA-F]{6}$/, "Colour must be a 6-digit hex value")
    .transform((v) => v.replace(/^#/, "").toLowerCase())
    // Safety orange — the road line and its overlay label both use it, matching the
    // Residential Mark Up convention. Still overridable via the API, just not in the UI.
    .default("e8642a"),
  opacityPercent: z.number().min(10).max(95).default(55),
  mapType: z.enum(["satellite", "hybrid", "roadmap"]).default("hybrid"),
  /** Adjusts the auto-computed tight-fit zoom — negative zooms out for more context, positive zooms in tighter. */
  zoomAdjust: z.number().int().min(-3).max(3).default(0),
};

/** Describe the stretch in words and let Google find it: the road plus the two cross
 *  streets that bound it. Costs two geocodes on top of the route. */
const crossStreetsSchema = z.object({
  mode: z.literal("cross_streets"),
  roadName: z.string().trim().min(1, "Road name is required").max(200),
  fromDesc: z.string().trim().min(1, "From cross street is required").max(200),
  toDesc: z.string().trim().min(1, "To cross street is required").max(200),
  area: z.string().trim().min(1, "Suburb/postcode is required").max(200),
  ...renderFields,
});

/** Give the two endpoints directly. Skips geocoding entirely — the escape hatch for
 *  stretches where naming the cross streets doesn't resolve (unnamed roads, easements, a
 *  mid-block start point). Parsed by parse-latlng.ts, which accepts decimal degrees, DMS
 *  and pasted Google Maps URLs. */
const coordinatesSchema = z.object({
  mode: z.literal("coordinates"),
  from: z.string().trim().min(1, "From coordinate is required").max(300),
  to: z.string().trim().min(1, "To coordinate is required").max(300),
  /** Optional. Supplied, the traced route is still checked against it and flagged if it
   *  doesn't appear to follow that road; omitted, there's nothing to check against. */
  roadName: z.string().trim().max(200).optional(),
  ...renderFields,
});

/** Paste a Google Maps directions URL and mark up the route it describes. Waypoints are
 *  lifted from the URL by parse-route-url.ts, which reads them out of the `data=` blob so
 *  they survive Google relabelling coordinates as place names. */
const routeUrlSchema = z.object({
  mode: z.literal("route_url"),
  // Directions URLs routinely run past 700 characters, and longer with many waypoints.
  url: z.string().trim().min(1, "Paste a Google Maps directions link").max(4000),
  /** Shown on the overlay panel above the distance. No road name to fall back on here. */
  label: z.string().trim().max(200).optional(),
  /** Numbered pins at each waypoint. Off gives a clean client-facing image — the same
   *  reason the Residential Mark Up strips its numbered pins for the client download. */
  showWaypointPins: z.boolean().default(true),
  ...renderFields,
});

/**
 * Requests predating coordinate mode don't carry `mode` at all, so default them to cross
 * streets rather than rejecting them — a discriminated union needs the key present.
 */
export const siteMarkupRequestSchema = z.preprocess(
  (value) =>
    value && typeof value === "object" && !Array.isArray(value) && !("mode" in value)
      ? { ...value, mode: "cross_streets" }
      : value,
  z.discriminatedUnion("mode", [crossStreetsSchema, coordinatesSchema, routeUrlSchema])
);

export type SiteMarkupRequest = z.infer<typeof siteMarkupRequestSchema>;
