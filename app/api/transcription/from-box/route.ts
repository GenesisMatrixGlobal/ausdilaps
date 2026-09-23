import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { after } from "next/server";
import { isStaffInAnyDepartment } from "@/lib/auth/is-staff";
import { getStaffUser } from "@/lib/auth/session";
import { recordToolUse } from "@/lib/tools/usage";
import {
  TRANSCRIPTION_ALLOW_UNAUTHED_ENV,
  TRANSCRIPTION_DEPARTMENTS,
  TRANSCRIPTION_TOOL_SLUG,
} from "@/lib/transcription/config";
import { deepgramConfigured } from "@/lib/transcription/deepgram";
import { BoxSourceError, resolveBoxAudio } from "@/lib/transcription/box-source";
import { transcribeFromUrl } from "@/lib/transcription/run";
import { BoxConfigError } from "@/lib/box";

export const runtime = "nodejs";
export const maxDuration = 290;

// Transcribe one recording that lives in Box. Box hands over a short-lived download URL and
// Deepgram fetches from it — nothing is copied and no size cap of ours applies. The ONE route
// that counts a tool use, so a folder of twenty counts twenty.

const bodySchema = z.object({
  fileId: z.string().regex(/^\d{1,20}$/),
  /** Present when the file was reached through a shared link the account cannot see directly. */
  sharedUrl: z.string().url().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  if (!(await isStaffInAnyDepartment(TRANSCRIPTION_DEPARTMENTS, TRANSCRIPTION_ALLOW_UNAUTHED_ENV))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }
  if (!deepgramConfigured()) {
    return NextResponse.json({ ok: false, error: "Transcription is not configured on this environment (DEEPGRAM_API_KEY)." }, { status: 503 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid input." }, { status: 400 });

  const user = await getStaffUser();
  after(() => recordToolUse(TRANSCRIPTION_TOOL_SLUG, user?.id));

  try {
    const source = await resolveBoxAudio(parsed.data.fileId, parsed.data.sharedUrl);
    const payload = await transcribeFromUrl(source.downloadUrl, source.name);
    return NextResponse.json({ ok: true, name: source.name, size: source.size, ...payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed.";
    console.error("[transcription/from-box]", message);
    if (err instanceof BoxSourceError) return NextResponse.json({ ok: false, error: message }, { status: 404 });
    if (err instanceof BoxConfigError) return NextResponse.json({ ok: false, error: "Box isn't configured on this environment." }, { status: 503 });
    // Upstream errors can echo tokens and signed URLs — don't relay them.
    const safe = /^(Deepgram API|Box API|Box download)/.test(message) ? "Transcription failed. Try that file again." : message;
    return NextResponse.json({ ok: false, error: safe }, { status: 502 });
  }
}
