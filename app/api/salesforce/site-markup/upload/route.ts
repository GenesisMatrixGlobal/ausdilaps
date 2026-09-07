// Write half of Sync To Salesforce: uploads the markup PNG into the folder the operator
// confirmed, then optionally writes its Box link onto the Quote.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { BoxNameConflictError } from "@/lib/box";
import { isConfigError, MarkupSyncError, uploadMarkup } from "@/lib/markup-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Generous, but bounded — a markup is ~900KB, ~1.2MB once base64'd, and Vercel caps the
 *  request body well below anything pathological. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** A save file is a few KB of coordinates; a megabyte is already absurd for one. */
const MAX_SIDECAR_BYTES = 2 * 1024 * 1024;

const requestSchema = z.object({
  quoteId: z.string().trim().min(15).max(18),
  /** Box folder ids are numeric strings. */
  folderId: z.string().trim().regex(/^\d+$/, "Invalid Box folder id"),
  filename: z.string().trim().min(1, "The file needs a name").max(240),
  /** Base64 PNG, supplied by the browser so the image isn't re-rendered (and re-billed). */
  image: z.string().min(1, "Missing image data"),
  linkToQuote: z.boolean().default(false),
  /** When present the link is written to this line item's own markup field instead of a
   *  Quote slot. The file still goes to the Quote's Box folder. */
  lineItemId: z.string().trim().min(15).max(18).optional(),
  /** The editable source for the image — a Measure or Building Markup .json save file,
   *  filed beside the PNG so the job can be reopened and adjusted rather than redrawn. */
  sidecar: z
    .object({
      filename: z.string().trim().min(1).max(240),
      contentBase64: z.string().min(1),
      contentType: z.string().trim().max(120).optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  if (!(await isStaff("MARKUP_SYNC_ALLOW_UNAUTHED"))) {
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
  if (bytes.length === 0) {
    return NextResponse.json({ ok: false, error: "The image data was unreadable." }, { status: 400 });
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return NextResponse.json({ ok: false, error: "That image is too large to sync." }, { status: 413 });
  }

  let sidecar: { filename: string; bytes: Uint8Array; contentType?: string } | undefined;
  if (parsed.data.sidecar) {
    const sidecarBytes = Buffer.from(parsed.data.sidecar.contentBase64, "base64");
    if (sidecarBytes.length === 0) {
      return NextResponse.json({ ok: false, error: "The save file data was unreadable." }, { status: 400 });
    }
    if (sidecarBytes.length > MAX_SIDECAR_BYTES) {
      return NextResponse.json({ ok: false, error: "That save file is too large to sync." }, { status: 413 });
    }
    sidecar = {
      filename: parsed.data.sidecar.filename,
      bytes: new Uint8Array(sidecarBytes),
      contentType: parsed.data.sidecar.contentType,
    };
  }

  try {
    const result = await uploadMarkup({
      quoteId: parsed.data.quoteId,
      folderId: parsed.data.folderId,
      filename: parsed.data.filename,
      bytes: new Uint8Array(bytes),
      linkToQuote: parsed.data.linkToQuote,
      lineItemId: parsed.data.lineItemId,
      sidecar,
    });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    if (isConfigError(e)) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 501 });
    }
    // The UI turns this into a rename prompt rather than a dead end.
    if (e instanceof BoxNameConflictError) {
      return NextResponse.json({ ok: false, error: e.message, conflict: true }, { status: 409 });
    }
    if (e instanceof MarkupSyncError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
