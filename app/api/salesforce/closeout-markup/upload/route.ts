// Write half: the PNG into the opportunity's Box folder, its link onto Closeout_Markup__c.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { BoxNameConflictError } from "@/lib/box";
import { isCloseoutConfigError, uploadCloseoutMarkup } from "@/lib/closeout-markup/sync";
import { MarkupSyncError } from "@/lib/markup-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Same bounds as the markup upload: a drawing is ~1MB, a save file a few KB. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_SIDECAR_BYTES = 2 * 1024 * 1024;

const requestSchema = z.object({
  opportunityId: z.string().trim().min(15).max(18),
  boxFolderUrl: z.string().trim().min(1).max(1000),
  filename: z.string().trim().min(1, "The file needs a name").max(240),
  /** Base64 PNG from the browser, so the image isn't re-rendered (and re-billed) server-side. */
  image: z.string().min(1, "Missing image data"),
  linkToOpportunity: z.boolean().default(false),
  replaceExistingLink: z.boolean().default(false),
  existingMarkupUrl: z.string().max(1000).nullable().default(null),
  sidecar: z
    .object({
      filename: z.string().trim().min(1).max(240),
      contentBase64: z.string().min(1),
      contentType: z.string().trim().max(120).optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  if (!(await isStaff("MARKUP_SYNC_ALLOW_UNAUTHED", "closeout-markup"))) {
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

  const bytes = Buffer.from(parsed.data.image, "base64");
  if (bytes.byteLength === 0) {
    return NextResponse.json({ ok: false, error: "The image was empty." }, { status: 400 });
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return NextResponse.json({ ok: false, error: "That image is too large to file." }, { status: 413 });
  }

  let sidecar: { filename: string; bytes: Uint8Array; contentType?: string } | undefined;
  if (parsed.data.sidecar) {
    const sidecarBytes = Buffer.from(parsed.data.sidecar.contentBase64, "base64");
    if (sidecarBytes.byteLength > MAX_SIDECAR_BYTES) {
      return NextResponse.json({ ok: false, error: "That save file is too large to file." }, { status: 413 });
    }
    sidecar = {
      filename: parsed.data.sidecar.filename,
      bytes: sidecarBytes,
      contentType: parsed.data.sidecar.contentType,
    };
  }

  try {
    const result = await uploadCloseoutMarkup({
      opportunityId: parsed.data.opportunityId,
      boxFolderUrl: parsed.data.boxFolderUrl,
      filename: parsed.data.filename,
      bytes,
      linkToOpportunity: parsed.data.linkToOpportunity,
      replaceExistingLink: parsed.data.replaceExistingLink,
      existingMarkupUrl: parsed.data.existingMarkupUrl,
      sidecar,
    });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    if (isCloseoutConfigError(e)) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 501 });
    }
    if (e instanceof BoxNameConflictError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    if (e instanceof MarkupSyncError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
