import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaffInAnyDepartment } from "@/lib/auth/is-staff";
import { TRANSCRIPTION_ALLOW_UNAUTHED_ENV, TRANSCRIPTION_DEPARTMENTS } from "@/lib/transcription/config";
import { parseBoxLink } from "@/lib/transcription/box-link";
import { BoxSourceError, listBoxAudio } from "@/lib/transcription/box-source";
import { BoxConfigError } from "@/lib/box";

export const runtime = "nodejs";
export const maxDuration = 30;

// What a pasted Box link contains — one recording or a folder's worth — so the queue can show
// names and sizes before a cent is spent. Reads only; the transcribe call is /from-box.

const bodySchema = z.object({ url: z.string().url().max(2000) });

export async function POST(req: NextRequest) {
  if (!(await isStaffInAnyDepartment(TRANSCRIPTION_DEPARTMENTS, TRANSCRIPTION_ALLOW_UNAUTHED_ENV))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That isn't a link." }, { status: 400 });
  const link = parseBoxLink(parsed.data.url);
  if (!link) return NextResponse.json({ ok: false, error: "That isn't a Box link. It should look like …box.com/file/123456, …box.com/folder/123456 or …box.com/s/…" }, { status: 400 });

  try {
    const listed = await listBoxAudio(link);
    return NextResponse.json({ ok: true, ...listed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read that Box link.";
    console.error("[transcription/box-list]", message);
    if (err instanceof BoxSourceError) return NextResponse.json({ ok: false, error: message }, { status: 404 });
    if (err instanceof BoxConfigError) return NextResponse.json({ ok: false, error: "Box isn't configured on this environment." }, { status: 503 });
    return NextResponse.json({ ok: false, error: "Could not read that Box link. Try again." }, { status: 502 });
  }
}
