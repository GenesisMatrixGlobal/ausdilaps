import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { GoogleMapsConfigError, renderStandardMarkupImage } from "@/lib/kml/standard-markup/render-image";
import { standardMarkupRenderRequestSchema } from "@/lib/kml/standard-markup/schema";

export const runtime = "nodejs";
export const maxDuration = 30;

// Re-renders from geometry the client already has (from a prior /api/kml/standard-markup
// call) — no geocoding or cadastre calls, so excluding a lot and regenerating is a
// single fast Static Maps request rather than repeating the whole slow lookup.
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

  const parsed = standardMarkupRenderRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { subjectRing, neighbours, mapType, zoomAdjust, excludeIds, hideSubject, frame } =
    parsed.data;
  // `councilAssets` is the pre-rename field name, read only as a fallback so a tab that
  // was open across the rename deploy keeps rendering instead of silently dropping the
  // operator's shapes.
  const shapes = parsed.data.shapes.length ? parsed.data.shapes : parsed.data.councilAssets;

  try {
    const rendered = await renderStandardMarkupImage({
      subjectRing,
      neighbours,
      mapType,
      zoomAdjust,
      excludeIds,
      hideSubject,
      frame,
      shapes,
    });
    return NextResponse.json({
      ok: true,
      image: rendered.imageBase64,
      flags: rendered.flags,
      center: rendered.center,
      zoom: rendered.zoom,
      imageSizePx: rendered.imageSizePx,
      scale: rendered.scale,
      fitZoom: rendered.fitZoom,
    });
  } catch (e) {
    if (e instanceof GoogleMapsConfigError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 501 });
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
