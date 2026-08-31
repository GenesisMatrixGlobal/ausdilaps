import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { parcelAtPoint } from "@/lib/kml/standard-markup/parcel-at-point";
import { parcelAtPointRequestSchema } from "@/lib/kml/standard-markup/schema";

export const runtime = "nodejs";
export const maxDuration = 30;

// Looks up the single titled parcel under a point the operator clicked on the map, so it
// can be added to the lot list. No geocoding and no adjacency filtering — unlike the
// address pipeline, the operator has already said which lot they mean.
export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_STANDARD_MARKUP_ALLOW_UNAUTHED"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = parcelAtPointRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { lat, lng, state } = parsed.data;
  try {
    const parcel = await parcelAtPoint(state, { lat, lng });
    if (!parcel) {
      // Not an error — clicking a road or a park is an ordinary miss, and the UI says so
      // rather than showing a failure.
      return NextResponse.json({ ok: true, parcel: null });
    }
    // Road reserves and easements come back labelled rather than dropped, so the caller
    // can explain what was clicked instead of claiming there's nothing there.
    return NextResponse.json({
      ok: true,
      parcel: { idKey: parcel.idKey, ring: parcel.ring, areaSqm: parcel.areaSqm, kind: parcel.kind },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
