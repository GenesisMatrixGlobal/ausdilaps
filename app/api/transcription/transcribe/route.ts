import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaffInAnyDepartment } from "@/lib/auth/is-staff";
import { getStaffUser } from "@/lib/auth/session";
import { recordToolUse } from "@/lib/tools/usage";
import { after } from "next/server";
import {
  TRANSCRIPTION_ALLOW_UNAUTHED_ENV,
  TRANSCRIPTION_DEPARTMENTS,
  TRANSCRIPTION_TOOL_SLUG,
} from "@/lib/transcription/config";
import { OBJECT_PATH_PATTERN, removeAudio, signedDownloadFor } from "@/lib/transcription/storage";
import { deepgramConfigured } from "@/lib/transcription/deepgram";
import { transcribeFromUrl } from "@/lib/transcription/run";

export const runtime = "nodejs";
// Deepgram answers a 15-minute file in ~10-20 s and the clean-up pass in ~20-40 s; the
// ceiling is for an hour-long recording on a slow day, not the normal case.
export const maxDuration = 290;

// Step 2 of 2. The bytes are already in Storage; this hands Deepgram a short-lived link,
// lays the result out in the Word layout, runs the mis-hearing pass, and deletes the audio.

const bodySchema = z.object({
  path: z.string().regex(OBJECT_PATH_PATTERN),
  name: z.string().min(1).max(255),
});

/** The tool's primary action — the ONE route that counts a tool use, so a batch of six files
 *  counts six transcriptions and the upload-url calls count nothing. */
export async function POST(req: NextRequest) {
  if (!(await isStaffInAnyDepartment(TRANSCRIPTION_DEPARTMENTS, TRANSCRIPTION_ALLOW_UNAUTHED_ENV))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }
  if (!deepgramConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Transcription is not configured on this environment (DEEPGRAM_API_KEY)." },
      { status: 503 }
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  // getStaffUser() is memoised per request, so this is the gate's own lookup, not a second one.
  const user = await getStaffUser();
  after(() => recordToolUse(TRANSCRIPTION_TOOL_SLUG, user?.id));

  const { path, name } = parsed.data;
  try {
    const audioUrl = await signedDownloadFor(path);
    const payload = await transcribeFromUrl(audioUrl, name);
    return NextResponse.json({ ok: true, ...payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed.";
    console.error("[transcription/transcribe]", message);
    // Upstream errors can echo the signed URL and key fragments — don't relay them.
    const safe = message.startsWith("Deepgram API") ? "Transcription failed. Try that file again." : message;
    return NextResponse.json({ ok: false, error: safe }, { status: 502 });
  } finally {
    // The audio has done its job. Whatever happened above, it does not stay in Storage.
    await removeAudio(path);
  }
}
