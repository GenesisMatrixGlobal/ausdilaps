import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { GoogleMapsConfigError } from "@/lib/kml/site-markup/static-map";
import { coverRenderRequestSchema } from "@/lib/cover-photo/schema";
import { renderCoverPhoto } from "@/lib/cover-photo/render";

export const runtime = "nodejs";
export const maxDuration = 30;

/** The tool's primary action, so this is the ONE route that passes the tool slug to
 *  isStaff() — a single operator action should count once, not once per API call. */
export async function POST(req: NextRequest) {
  if (!(await isStaff("COVER_PHOTO_ALLOW_UNAUTHED", "cover-photo"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = coverRenderRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await renderCoverPhoto(parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof GoogleMapsConfigError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 501 });
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
