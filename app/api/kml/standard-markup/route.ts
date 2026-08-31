import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { GoogleMapsConfigError, numberNeighbours, renderStandardMarkupImage } from "@/lib/kml/standard-markup/render-image";
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

  const { street, suburb, postcode, state, mapType, zoomAdjust } = parsed.data;

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
      error: "Something went wrong looking up that address.",
    };
    const detail = resolved.flags.length > 0 ? ` (${resolved.flags.join("; ")})` : "";
    return NextResponse.json({ ok: false, error: `${messages[resolved.status]}${detail}` }, { status: 404 });
  }

  const neighbours = numberNeighbours(resolved.neighbours);

  try {
    const rendered = await renderStandardMarkupImage({
      subjectRing: resolved.subjectRing,
      neighbours,
      mapType,
      zoomAdjust,
    });
    return NextResponse.json({
      ok: true,
      image: rendered.imageBase64,
      subjectRing: resolved.subjectRing,
      neighbours,
      matchedAddress: resolved.matchedAddress,
      mapType,
      zoomAdjust,
      flags: [...resolved.flags, ...rendered.flags],
      center: rendered.center,
      zoom: rendered.zoom,
      fitZoom: rendered.fitZoom,
      imageSizePx: rendered.imageSizePx,
      scale: rendered.scale,
    });
  } catch (e) {
    if (e instanceof GoogleMapsConfigError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 501 });
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
