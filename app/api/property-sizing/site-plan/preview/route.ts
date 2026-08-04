import { NextRequest, NextResponse } from "next/server";
import { buildPreview } from "@/lib/property-sizing/site-plan";
import { isStaff } from "@/lib/auth/is-staff";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!(await isStaff("PROPERTY_SIZING_ALLOW_UNAUTHED"))) {
    return NextResponse.json(
      { ok: false, error: "Not authorised — staff login required." },
      { status: 401 }
    );
  }

  let json: { pdf?: { data?: string; mediaType?: string } };
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  if (!json.pdf?.data) {
    return NextResponse.json({ ok: false, error: "Drop in a PDF site plan first." }, { status: 400 });
  }

  try {
    const bytes = Buffer.from(json.pdf.data, "base64");
    const preview = await buildPreview(bytes);
    return NextResponse.json({ ok: true, ...preview });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
