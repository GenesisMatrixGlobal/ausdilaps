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
import { BoxSourceError, parseBoxFileLink, resolveBoxAudio } from "@/lib/transcription/box-source";
import { transcribeFromUrl } from "@/lib/transcription/run";
import { BoxConfigError } from "@/lib/box";

export const runtime = "nodejs";
export const maxDuration = 290;

// A recording already filed in Box, by link. Box hands over a short-lived download URL and
// Deepgram fetches from it — nothing is copied to Storage and no size cap of ours applies.
// Counts a tool use like /transcribe does: it is the same action from a different source.

const bodySchema = z.object({ url: z.string().url().max(2000) });

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
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That isn't a link." }, { status: 400 });
  const link = parseBoxFileLink(parsed.data.url);
  if (!link) {
    return NextResponse.json({ ok: false, error: "That isn't a Box file link. It should look like …box.com/file/123456 or …box.com/s/…" }, { status: 400 });
  }

  const user = await getStaffUser();
  after(() => recordToolUse(TRANSCRIPTION_TOOL_SLUG, user?.id));

  try {
    const source = await resolveBoxAudio(link);
    const payload = await transcribeFromUrl(source.downloadUrl, source.name);
    return NextResponse.json({ ok: true, name: source.name, size: source.size, ...payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed.";
    console.error("[transcription/from-box]", message);
    if (err instanceof BoxSourceError) return NextResponse.json({ ok: false, error: message }, { status: 404 });
    if (err instanceof BoxConfigError) return NextResponse.json({ ok: false, error: "Box isn't configured on this environment." }, { status: 503 });
    // Upstream errors can echo tokens and signed URLs — don't relay them.
    const safe = /^(Deepgram API|Box API|Box download)/.test(message) ? "Transcription failed. Try that link again." : message;
    return NextResponse.json({ ok: false, error: safe }, { status: 502 });
  }
}
