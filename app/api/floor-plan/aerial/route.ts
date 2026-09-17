import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { aerialConfigured, fetchAerial } from "@/lib/floor-plan/aerial";

export const runtime = "nodejs";
// One image fetch. Nothing here is slow, but the default ceiling is tight enough that a cold
// start plus a sluggish Google call could reach it.
export const maxDuration = 30;

// The frame the operator left the live map on. Bounds rather than centre+zoom because the
// map's zoom is fractional and Static Maps takes integers — see lib/floor-plan/frame.ts.
const bodySchema = z.object({
  bounds: z.object({
    south: z.number().min(-90).max(90),
    west: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
  }),
  label: z.string().max(300).default(""),
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
    return NextResponse.json({ ok: false, error: "No map frame to capture." }, { status: 400 });
  }
  const { bounds } = parsed.data;
  if (bounds.north <= bounds.south || bounds.east <= bounds.west) {
    return NextResponse.json({ ok: false, error: "That map frame is empty." }, { status: 400 });
  }

  const outcome = await fetchAerial(bounds, parsed.data.label);

  if (outcome.status === "not_configured") {
    return NextResponse.json({ ok: false, error: "Satellite imagery is not configured." }, { status: 503 });
  }
  if (outcome.status === "failed") {
    return NextResponse.json({ ok: false, error: outcome.detail }, { status: 502 });
  }

  return NextResponse.json({ ok: true, aerial: outcome.aerial });
}
