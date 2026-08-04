import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { extractPageImages } from "@/lib/property-sizing/site-plan/pdf-image";
import { isStaff } from "@/lib/auth/is-staff";

export const runtime = "nodejs";
export const maxDuration = 60;

const CROP_HALF_SIZE = 150; // ±150 native px (~70m square at a typical 1:2750 site plan scale)

export async function POST(req: NextRequest) {
  if (!(await isStaff("PROPERTY_SIZING_ALLOW_UNAUTHED"))) {
    return NextResponse.json(
      { ok: false, error: "Not authorised — staff login required." },
      { status: 401 }
    );
  }

  let json: { pdf?: { data?: string }; page?: number; x?: number; y?: number };
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  if (!json.pdf?.data || json.page == null || json.x == null || json.y == null) {
    return NextResponse.json({ ok: false, error: "Missing pdf, page, x or y." }, { status: 400 });
  }

  try {
    const bytes = Buffer.from(json.pdf.data, "base64");
    const images = await extractPageImages(bytes);
    const image = images.find((i) => i.page === json.page);
    if (!image) {
      return NextResponse.json({ ok: false, error: `No page ${json.page} in that PDF.` }, { status: 400 });
    }

    const left = Math.max(0, Math.min(image.pixelWidth - 1, Math.round(json.x - CROP_HALF_SIZE)));
    const top = Math.max(0, Math.min(image.pixelHeight - 1, Math.round(json.y - CROP_HALF_SIZE)));
    const width = Math.min(image.pixelWidth - left, CROP_HALF_SIZE * 2);
    const height = Math.min(image.pixelHeight - top, CROP_HALF_SIZE * 2);

    const cropBuf = await sharp(image.jpeg).extract({ left, top, width, height }).png().toBuffer();

    return NextResponse.json({
      ok: true,
      pngBase64: cropBuf.toString("base64"),
      cropLeft: left,
      cropTop: top,
      cropWidth: width,
      cropHeight: height,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
