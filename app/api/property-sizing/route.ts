import { NextRequest, NextResponse } from "next/server";
import { parseAddressBlock } from "@/lib/property-sizing/parse";
import { extractAddressesFromImage, ocrConfigured } from "@/lib/property-sizing/ocr";
import { sizeProperties } from "@/lib/property-sizing";
import type { ParsedAddress } from "@/lib/property-sizing/types";
import { isStaff } from "@/lib/auth/is-staff";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!(await isStaff("PROPERTY_SIZING_ALLOW_UNAUTHED", "property-sizing"))) {
    return NextResponse.json(
      { ok: false, error: "Not authorised — staff login required." },
      { status: 401 }
    );
  }

  let json: { text?: string; image?: { data?: string; mediaType?: string } };
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  let addresses: ParsedAddress[];
  if (json.image?.data) {
    if (!ocrConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Screenshot reading isn't configured yet (missing ANTHROPIC_API_KEY). Paste the addresses as text instead.",
        },
        { status: 400 }
      );
    }
    try {
      addresses = await extractAddressesFromImage(json.image.data, json.image.mediaType ?? "image/png");
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: `Couldn't read the screenshot: ${(e as Error).message}` },
        { status: 502 }
      );
    }
  } else if (json.text?.trim()) {
    addresses = parseAddressBlock(json.text);
  } else {
    return NextResponse.json(
      { ok: false, error: "Provide a screenshot or paste addresses." },
      { status: 400 }
    );
  }

  if (!addresses.length) {
    return NextResponse.json({ ok: false, error: "No addresses found." }, { status: 422 });
  }

  const results = await sizeProperties(addresses);
  return NextResponse.json({ ok: true, count: results.length, results });
}
