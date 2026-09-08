import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { resolveStandardMarkup, type StandardMarkupStatus } from "@/lib/kml/standard-markup/resolve";
import { standardMarkupRequestSchema } from "@/lib/kml/standard-markup/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_STANDARD_MARKUP_ALLOW_UNAUTHED", "site-markups"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = standardMarkupRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { street, suburb, postcode, state, mapType } = parsed.data;

  let resolved;
  try {
    resolved = await resolveStandardMarkup({ street, suburb, postcode }, state);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }

  if (resolved.status !== "ok") {
    const messages: Record<Exclude<StandardMarkupStatus, "ok">, string> = {
      not_found: `Couldn't find "${street}, ${suburb}" — check the spelling, or add a postcode.`,
      no_parcel: `Found the address but no titled parcel there — measure manually.`,
      // Deliberately does NOT blame the address. This status means the state's cadastre
      // service failed, and the old wording ("Something went wrong looking up that address")
      // sent operators off to re-check a spelling that was already correct.
      error: "The state cadastre lookup failed — this is the government service, not your address. Try again shortly, or measure manually.",
    };
    const detail = resolved.flags.length > 0 ? ` (${resolved.flags.join("; ")})` : "";
    return NextResponse.json({ ok: false, error: `${messages[resolved.status]}${detail}` }, { status: 404 });
  }

  // No image, and no numbering. The tab renders a live Maps JS map, so Generate returns geometry
  // only — which removes a billed Static Maps call from every snapshot. Numbers are quote item
  // numbers now, derived from the sheet's tick state on the client (see rowsFrom), so assigning
  // them here would only create a second series that went stale on the first untick.
  return NextResponse.json({
    ok: true,
    subjectRing: resolved.subjectRing,
    subjectLotPlan: resolved.subjectLotPlan,
    subjectAreaSqm: resolved.subjectAreaSqm,
    neighbours: resolved.neighbours,
    matchedAddress: resolved.matchedAddress,
    mapType,
    flags: resolved.flags,
  });
}
