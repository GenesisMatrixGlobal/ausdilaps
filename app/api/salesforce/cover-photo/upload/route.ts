// Write half of the Cover Photo sync: uploads the PNG into the folder the operator confirmed,
// then optionally writes its Box link onto the Survey's Cover_Photo_URL__c.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { BoxNameConflictError } from "@/lib/box";
import { CoverPhotoSyncError, isConfigError, uploadCoverPhoto } from "@/lib/cover-photo/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

/** A cover photo is 600x442 — a couple of hundred KB. Generous, but bounded. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const requestSchema = z.object({
  /** A Survey ID ONLY, never pasted text. The client has already resolved it through
   *  /resolve and shown the operator the Survey and its Opportunity, so a mistyped
   *  reference cannot reach a record nobody looked at. */
  surveyId: z.string().trim().regex(/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/, "Not a Salesforce Id"),
  /** Box folder ids are numeric strings. */
  folderId: z.string().trim().regex(/^\d+$/, "Invalid Box folder id"),
  filename: z.string().trim().min(1, "The file needs a name").max(240),
  /** Base64 PNG, rendered by the browser so the image isn't re-rendered (and re-billed). */
  image: z.string().min(1, "Missing image data"),
  linkToSurvey: z.boolean().default(false),
  replaceExistingLink: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  if (!(await isStaff("COVER_PHOTO_ALLOW_UNAUTHED"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(parsed.data.image, "base64");
  } catch {
    return NextResponse.json({ ok: false, error: "The image data was unreadable." }, { status: 400 });
  }
  if (bytes.byteLength === 0) {
    return NextResponse.json({ ok: false, error: "The image data was unreadable." }, { status: 400 });
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return NextResponse.json({ ok: false, error: "That image is too large to sync." }, { status: 413 });
  }

  try {
    const result = await uploadCoverPhoto({
      surveyId: parsed.data.surveyId,
      folderId: parsed.data.folderId,
      filename: parsed.data.filename,
      bytes,
      linkToSurvey: parsed.data.linkToSurvey,
      replaceExistingLink: parsed.data.replaceExistingLink,
    });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    if (isConfigError(e)) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 501 });
    }
    if (e instanceof BoxNameConflictError) {
      return NextResponse.json({ ok: false, error: e.message, conflict: true }, { status: 409 });
    }
    if (e instanceof CoverPhotoSyncError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
