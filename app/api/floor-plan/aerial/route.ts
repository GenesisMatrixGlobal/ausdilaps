import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import {
  aerialConfigured,
  clampZoom,
  DEFAULT_ZOOM,
  fetchAerial,
  fetchAerialAt,
} from "@/lib/floor-plan/aerial";

export const runtime = "nodejs";
// A geocode and one image fetch. Nothing here is slow, but the default ceiling is tight
// enough that a cold start plus a sluggish Google call could reach it.
export const maxDuration = 30;

// Two ways in. The address box sends a COORDINATE, because the Places autocomplete it
// shares with the other marker tools already resolved one; free text is the fallback for
// something typed and never picked out of the list.
const bodySchema = z.object({
  address: z.string().min(3).max(300).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  /** What to write in the title block. A pasted map link often has no address at all. */
  label: z.string().max(300).optional(),
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

  const { address, lat, lng, label } = parsed.data;
  const zoom = clampZoom(parsed.data.zoom ?? DEFAULT_ZOOM);

  const haveCentre = lat !== undefined && lng !== undefined;
  if (!haveCentre && !address) {
    return NextResponse.json({ ok: false, error: "Type an address to look up." }, { status: 400 });
  }

  const outcome = haveCentre
    ? await fetchAerialAt({ lat: lat as number, lng: lng as number }, label ?? address ?? "", zoom)
    : await fetchAerial(address as string, zoom);

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
