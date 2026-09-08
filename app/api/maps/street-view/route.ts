import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { GoogleMapsConfigError } from "@/lib/kml/site-markup/static-map";
import { projectToLocalMetres } from "@/lib/kml/standard-markup/geometry";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * Which way a Street View camera has to look to see a given point.
 *
 * Needed because Google does NOT derive a heading from the `viewpoint` in a Maps URL, despite
 * its docs saying so — see lib/maps/street-view.ts for the test that established that. An
 * explicit heading IS honoured, so all this route has to answer is "where is the camera?".
 *
 * Server-side and free. `/streetview/metadata` consumes no quota ("Street View Static API
 * metadata requests are available at no charge"), and the billed image endpoint is never called
 * from here. It has to be server-side anyway: the Geocoding-family web services reject a
 * referrer-restricted key, so this uses GOOGLE_MAPS_API_KEY, which is never published.
 *
 * The Maps JS alternative, StreetViewService.getPanorama(), was rejected — Google documents
 * "Dynamic Street View is billed per panorama" and exempts nothing for metadata.
 */

const METADATA_URL = "https://maps.googleapis.com/maps/api/streetview/metadata";

/** How far around the point to look for a panorama. Wide enough to find the street in front of
 *  a deep suburban block, tight enough not to answer with a road one property over. */
const SEARCH_RADIUS_M = 70;

/** Below this the camera is effectively standing on the target, so a bearing is noise — and any
 *  direction is as good as another. Google's own default is a better answer than a random one. */
const MIN_USEFUL_DISTANCE_M = 2;

interface MetadataResp {
  status?: string;
  error_message?: string;
  location?: { lat?: number; lng?: number };
  pano_id?: string;
  date?: string;
}

export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_STANDARD_MARKUP_ALLOW_UNAUTHED"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let json: { lat?: number; lng?: number };
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const { lat, lng } = json;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return NextResponse.json({ ok: false, error: "Invalid coordinates." }, { status: 400 });
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { ok: false, error: new GoogleMapsConfigError("GOOGLE_MAPS_API_KEY not configured.").message },
      { status: 501 }
    );
  }

  try {
    const params = new URLSearchParams({
      location: `${lat.toFixed(7)},${lng.toFixed(7)}`,
      radius: String(SEARCH_RADIUS_M),
      // Outdoor only: an indoor business photosphere inside the building would give a heading
      // that means nothing on the street.
      source: "outdoor",
      key,
    });
    const res = await fetch(`${METADATA_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const data = (await res.json()) as MetadataResp;

    // ZERO_RESULTS is an ordinary answer, not a failure — plenty of rural and industrial sites
    // have no coverage. ok:true with a null heading means "open it anyway, unaimed".
    if (data.status !== "OK" || data.location?.lat === undefined || data.location?.lng === undefined) {
      return NextResponse.json({
        ok: true,
        heading: null,
        reason: data.status === "ZERO_RESULTS" ? "no_coverage" : (data.status ?? "unknown"),
      });
    }

    const camera = { lat: data.location.lat, lng: data.location.lng };
    const { east, north } = projectToLocalMetres(camera, { lat, lng });
    if (Math.hypot(east, north) < MIN_USEFUL_DISTANCE_M) {
      return NextResponse.json({ ok: true, heading: null, reason: "on_top_of_it" });
    }

    // Compass bearing: clockwise from north, which is what the `heading` URL parameter takes.
    // atan2(east, north) — NOT the usual atan2(y, x) — is what puts 0 at north and 90 at east.
    const heading = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
    return NextResponse.json({
      ok: true,
      heading: Math.round(heading * 10) / 10,
      panoDate: data.date ?? null,
      distanceM: Math.round(Math.hypot(east, north)),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
