// Screenshot → address lines, for the multi-property markup's drop zone.
//
// Reads the image with the same vision pass Bulk Property Sizing's screenshot mode uses
// (lib/property-sizing/ocr.ts) and hands back one LINE per address, ready to be appended to
// the paste box. Deliberately not "screenshot → markup": the lines land in the box first so the
// operator sees what was read — a misread digit is caught there, not on the drawing.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { extractAddressesFromImage, ocrConfigured } from "@/lib/property-sizing/ocr";
import { displayStreet } from "@/lib/property-sizing";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const requestSchema = z.object({
  image: z.object({
    data: z.string().min(1),
    mediaType: z.string().regex(/^image\/(png|jpe?g|webp|gif)$/i, "Not an image"),
  }),
});

export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_STANDARD_MARKUP_ALLOW_UNAUTHED", "site-markups"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }
  if (!ocrConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Screenshot reading isn't configured (missing ANTHROPIC_API_KEY). Paste the addresses as text instead." },
      { status: 501 }
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  // Base64 is 4/3 of the bytes; a cheap check before the decode.
  if (parsed.data.image.data.length > (MAX_IMAGE_BYTES * 4) / 3) {
    return NextResponse.json({ ok: false, error: "That image is over 8 MB — crop it to the address list." }, { status: 413 });
  }

  try {
    const addresses = await extractAddressesFromImage(parsed.data.image.data, parsed.data.image.mediaType);
    const lines = addresses.map((a) =>
      [displayStreet(a), [a.suburb, a.state, a.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    );
    return NextResponse.json({ ok: true, lines });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Couldn't read the screenshot: ${(e as Error).message}` }, { status: 502 });
  }
}
