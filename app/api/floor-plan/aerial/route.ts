import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { aerialConfigured, clampZoom, DEFAULT_ZOOM, fetchAerial } from "@/lib/floor-plan/aerial";

export const runtime = "nodejs";
// A geocode and one image fetch. Nothing here is slow, but the default ceiling is tight
// enough that a cold start plus a sluggish Google call could reach it.
export const maxDuration = 30;

const bodySchema = z.object({
  address: z.string().min(3).max(300),
  zoom: z.number().int().min(1).max(30).optional(),
});

export async function POST(req: NextRequest) {
  if (!(await isStaff("FLOOR_PLAN_ALLOW_UNAUTHED"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  if (!aerialConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Satellite imagery is not configured on this environment. Upload an aerial image instead.",
      },
      { status: 503 }
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Type an address to look up." }, { status: 400 });
  }

  const outcome = await fetchAerial(parsed.data.address, clampZoom(parsed.data.zoom ?? DEFAULT_ZOOM));

  if (outcome.status === "no_match") {
    return NextResponse.json(
      { ok: false, error: "No match for that address. Try adding the suburb and state." },
      { status: 404 }
    );
  }
  if (outcome.status === "not_configured") {
    return NextResponse.json({ ok: false, error: "Satellite imagery is not configured." }, { status: 503 });
  }
  if (outcome.status === "failed") {
    return NextResponse.json({ ok: false, error: outcome.detail }, { status: 502 });
  }

  return NextResponse.json({ ok: true, aerial: outcome.aerial });
}
