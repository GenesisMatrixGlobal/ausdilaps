import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaffInAnyDepartment } from "@/lib/auth/is-staff";
import {
  ACCEPTED_AUDIO_MIME,
  MAX_AUDIO_BYTES,
  TRANSCRIPTION_ALLOW_UNAUTHED_ENV,
  TRANSCRIPTION_DEPARTMENTS,
} from "@/lib/transcription/config";
import { ensureDictationBucket, objectPathFor, signedUploadFor } from "@/lib/transcription/storage";
import { deepgramConfigured } from "@/lib/transcription/deepgram";

export const runtime = "nodejs";
export const maxDuration = 15;

// Step 1 of 2. The browser asks for somewhere to put the audio, then PUTs the bytes STRAIGHT
// to Supabase Storage on the signed URL — never through here. Vercel rejects any function
// body over 4.5 MB before a route runs, and a ten-minute phone recording is twice that.

const bodySchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().positive().max(MAX_AUDIO_BYTES),
  type: z.string().max(100),
});

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
  // Browsers report an empty type for some .m4a/.mp3 files; the extension check on the client
  // already passed, so an empty type is let through and the bucket's own list decides.
  const type = parsed.data.type;
  if (type && !(ACCEPTED_AUDIO_MIME as readonly string[]).includes(type)) {
    return NextResponse.json({ ok: false, error: "That doesn't look like an audio file." }, { status: 400 });
  }

  try {
    await ensureDictationBucket();
    const path = objectPathFor(parsed.data.name);
    const { token, signedUrl } = await signedUploadFor(path);
    return NextResponse.json({ ok: true, path, token, signedUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not prepare the upload.";
    console.error("[transcription/upload-url]", message);
    return NextResponse.json({ ok: false, error: "Could not prepare the upload. Try again." }, { status: 502 });
  }
}
