import { z } from "zod";

/**
 * A 517 KB KMZ base64-encodes to ~690 KB, and these files grow with the network. 12 MB of
 * base64 (~9 MB of KMZ) is generous headroom while still bounding the request body.
 */
const MAX_BASE64_CHARS = 12_000_000;

const filePayload = z.object({
  /** base64 of the raw .kmz or .kml bytes. */
  data: z.string().min(1, "Missing file data").max(MAX_BASE64_CHARS, "That file is too large."),
  name: z.string().trim().max(255).optional(),
});

export const roadSurveyParseRequestSchema = z.object({ file: filePayload });

/**
 * Enrichment re-sends the file rather than the parsed geometry.
 *
 * The alternative — posting back every segment's coordinate path so the server can do
 * proximity matching — is ~1 MB of JSON for this network, and it would mean trusting
 * client-supplied geometry to drive the lookups. Re-parsing costs about 100 ms against
 * the 60-odd seconds the Overpass calls take, and segment ids are derived deterministically
 * from the file, so the enrichment map merges cleanly onto the rows the client already has.
 */
export const roadSurveyEnrichRequestSchema = z.object({ file: filePayload });
