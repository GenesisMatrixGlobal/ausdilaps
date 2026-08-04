import { NextRequest, NextResponse } from "next/server";
import { measureSitePlan } from "@/lib/property-sizing/site-plan";
import { visionConfigured } from "@/lib/property-sizing/site-plan/label-vision";
import { isStaff } from "@/lib/auth/is-staff";
import type { MeasureRequest } from "@/lib/property-sizing/site-plan/types";

export const runtime = "nodejs";
export const maxDuration = 290;

export async function POST(req: NextRequest) {
  if (!(await isStaff("PROPERTY_SIZING_ALLOW_UNAUTHED"))) {
    return NextResponse.json(
      { ok: false, error: "Not authorised — staff login required." },
      { status: 401 }
    );
  }

  let json: Partial<MeasureRequest>;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  if (!json.pdf?.data) {
    return NextResponse.json({ ok: false, error: "Drop in a PDF site plan first." }, { status: 400 });
  }
  if (!json.scaleRatio || json.scaleRatio <= 0) {
    return NextResponse.json({ ok: false, error: "Enter the drawing's print scale (the N in 1:N)." }, { status: 400 });
  }
  if (!json.color) {
    return NextResponse.json({ ok: false, error: "Pick which colour to measure first." }, { status: 400 });
  }
  if (!visionConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Reading building codes needs ANTHROPIC_API_KEY configured on the server." },
      { status: 400 }
    );
  }

  try {
    const bytes = Buffer.from(json.pdf.data, "base64");
    const results = await measureSitePlan(bytes, json.scaleRatio, json.color, json.tolerance ?? 30, json.calibration);
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
