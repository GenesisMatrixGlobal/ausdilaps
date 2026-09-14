// Storeys for a batch of lots — Street View + vision, see lib/storeys/street-view-storeys.ts.
//
// Small batches (≤ 10) with four in flight, so one request stays well inside the function's
// time limit; the client pages a long sheet through here. A miss (no coverage, no camera
// outside the parcel) is an ordinary answer per lot, never a failed request.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { mapPool } from "@/lib/util/map-pool";
import { ringAnchor } from "@/lib/kml/standard-markup/measure";
import { estimateStoreys, type StoreyResult } from "@/lib/storeys/street-view-storeys";

export const runtime = "nodejs";
export const maxDuration = 60;

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const requestSchema = z.object({
  lots: z
    .array(
      z.object({
        key: z.string().min(1).max(200),
        ring: z.array(latLng).min(3).max(2000),
        label: z.string().max(200).default(""),
      })
    )
    .min(1)
    .max(10),
});

export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_STANDARD_MARKUP_ALLOW_UNAUTHED", "site-markups"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }
  const maps = process.env.GOOGLE_MAPS_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (!maps || !anthropic) {
    return NextResponse.json({ ok: false, error: "Storey checks aren't configured (GOOGLE_MAPS_API_KEY and ANTHROPIC_API_KEY)." }, { status: 501 });
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

  const results = await mapPool(parsed.data.lots, 4, async (lot): Promise<{ key: string; result: StoreyResult | { status: "error"; error: string } }> => {
    try {
      const result = await estimateStoreys({ target: ringAnchor(lot.ring), parcel: lot.ring, label: lot.label }, { maps, anthropic });
      return { key: lot.key, result };
    } catch (e) {
      return { key: lot.key, result: { status: "error", error: (e as Error).message } };
    }
  });
  return NextResponse.json({ ok: true, results });
}
