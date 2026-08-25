import { z } from "zod";
import { SERVICE_KEYS } from "./profile";

/**
 * The classifier's output contract.
 *
 * Strict where a wrong value is dangerous, lenient where it is cosmetic:
 *
 *   - `relevance` has NO fallback. A missing or unrecognised verdict must fail the parse,
 *     never quietly become "no_match" — that would turn a model hiccup into a silently
 *     missed tender, which is the exact failure this feature exists to prevent.
 *   - `summary` and `reasoning` are required. The digest is the product; an item with no
 *     reasoning is not shippable, so it should surface as an error instead.
 *   - everything else `.catch()`es to a safe default, because a malformed closing date is
 *     not worth discarding a real match over.
 *
 * 'pending' and 'error' are OUR states, not the model's, so they are absent here.
 */
export const classificationSchema = z.object({
  relevance: z.enum(["match", "maybe", "no_match"]),
  confidence: z.number().min(0).max(1).catch(0),
  services: z.array(z.enum(SERVICE_KEYS)).max(SERVICE_KEYS.length).catch([]),
  title: z.string().trim().max(300).catch(""),
  agency: z.string().trim().max(200).nullable().catch(null),
  jurisdiction: z.string().trim().max(60).nullable().catch(null),
  closes_at: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .catch(null),
  summary: z.string().trim().min(1).max(400),
  reasoning: z.string().trim().min(1).max(800),
  injection_suspected: z.boolean().catch(false),
});

export type ClassificationPayload = z.infer<typeof classificationSchema>;

/** Body for the manual "Run scan now" button and the summary read. */
export const summaryRequestSchema = z.object({
  days: z.number().int().min(1).max(90).catch(30),
});
