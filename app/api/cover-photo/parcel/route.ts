import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { resolveStandardMarkup } from "@/lib/kml/standard-markup/resolve";
import { coverParcelRequestSchema } from "@/lib/cover-photo/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The property boundary for a cover photo.
 *
 * Reuses Building Markup's cadastre pipeline and throws away everything except the subject's
 * own ring — a cover photo shows one property, so the neighbours it resolves are not wanted.
 *
 * ⚠️ A miss is NOT an error here, unlike /api/kml/standard-markup. Without a boundary there is
 * no markup, but there is still a perfectly good cover photo: the operator gets an aerial of
 * the address and draws the area themselves. So every outcome is a 200 with `ring: null` and
 * a plain-English note, and the tool carries on.
 */
export async function POST(req: NextRequest) {
  if (!(await isStaff("COVER_PHOTO_ALLOW_UNAUTHED"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = coverParcelRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { street, suburb, postcode, state } = parsed.data;

  let resolved;
  try {
    resolved = await resolveStandardMarkup({ street, suburb, postcode }, state);
  } catch (e) {
    // resolveStandardMarkup already turns its own failures into a status; this is the
    // unexpected kind. Still not fatal — say so and let the operator draw.
    return NextResponse.json({
      ok: true,
      ring: null,
      matchedAddress: null,
      note: `Couldn't reach the ${state} cadastre (${(e as Error).message}) — draw the area by hand.`,
    });
  }

  if (resolved.status !== "ok") {
    const notes: Record<string, string> = {
      not_found: `Couldn't find "${street}, ${suburb}" in the ${state} cadastre — check the address, or draw the area by hand.`,
      no_parcel: "Found the address but no titled parcel there — draw the area by hand.",
      // Deliberately does not blame the address: this status means the government service
      // failed, and wording it as a lookup problem sends operators off to re-check a spelling
      // that was already correct.
      error: `The ${state} cadastre service didn't answer — that's the government service, not your address. Draw the area by hand, or try again shortly.`,
    };
    return NextResponse.json({
      ok: true,
      ring: null,
      matchedAddress: resolved.matchedAddress,
      note: notes[resolved.status],
    });
  }

  return NextResponse.json({
    ok: true,
    ring: resolved.subjectRing,
    matchedAddress: resolved.matchedAddress,
    // Only the flags worth a line on screen. The VIC one matters: while Vicmap's parcel layer
    // is down the outline is a PROPERTY boundary, not a titled parcel.
    note: resolved.flags.length > 0 ? resolved.flags.join("; ") : null,
  });
}
