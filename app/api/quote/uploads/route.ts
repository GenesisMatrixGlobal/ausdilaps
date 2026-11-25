import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { adminClientConfigured } from "@/lib/supabase/env";
import { checkTurnstile } from "@/lib/turnstile";
import { issueUploadSlots, sweepOrphanUploads } from "@/lib/enquiry-uploads";
import {
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_TOTAL_BYTES,
  UPLOAD_KINDS,
  uploadTypeFor,
} from "@/lib/enquiry-uploads-options";
import { SITE } from "@/lib/site";

/**
 * Step one of an enquiry with attachments: hands the browser a signed upload URL per file.
 *
 * The bot check happens HERE, because this is the call that lets a stranger write to our
 * storage. A Turnstile token is single-use, so the `ticket` returned is what /api/quote
 * accepts in its place when the form itself is submitted a few seconds later.
 */
const schema = z.object({
  turnstileToken: z.string().max(4096).optional().default(""),
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(300),
        size: z.number().int().positive().max(MAX_UPLOAD_FILE_BYTES),
      })
    )
    .min(1)
    .max(MAX_UPLOAD_FILES),
});

const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail("Invalid request", 400);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return fail("Those files can't be attached. Check the type and size, then try again.", 400);
  const { files, turnstileToken } = parsed.data;

  if (files.some((f) => !uploadTypeFor(f.name))) return fail(`Only ${UPLOAD_KINDS} files can be attached.`, 400);
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_UPLOAD_TOTAL_BYTES) {
    return fail("Those files are too large together. Remove one and try again.", 400);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const turnstile = await checkTurnstile(turnstileToken, ip);
  if (turnstile === "failed") return fail("Verification failed. Please try again.", 400);

  const emailInstead = `Attachments aren't available right now. Please send without them, or email ${SITE.email}.`;
  if (turnstile === "unconfigured" || !adminClientConfigured()) return fail(emailInstead, 503);

  try {
    const slots = await issueUploadSlots(files);
    after(sweepOrphanUploads);
    return NextResponse.json({ ok: true, ...slots });
  } catch (e) {
    console.error("[quote] could not issue upload slots:", e);
    return fail(emailInstead, 503);
  }
}
