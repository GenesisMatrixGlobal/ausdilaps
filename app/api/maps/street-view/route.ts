import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { GoogleMapsConfigError } from "@/lib/kml/site-markup/static-map";
import { pointInRing, projectToLocalMetres } from "@/lib/kml/standard-markup/geometry";
import { findStreetCameras } from "@/lib/storeys/street-view-storeys";
import { parcelAtPointAnyState } from "@/lib/kml/standard-markup/parcel-at-point";
import type { LatLng } from "@/lib/kml/types";
import { recordApiCall } from "@/lib/api-usage";

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
  copyright?: string;
}

export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_STANDARD_MARKUP_ALLOW_UNAUTHED"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let json: { lat?: number; lng?: number; ring?: unknown };
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

  // The property's boundary, when the caller has one. A camera standing INSIDE it is indoors
  // (a shop's photosphere) or in the yard — never a view of the facade from the street.
  const ring: LatLng[] | null =
    Array.isArray(json.ring) &&
    json.ring.length >= 3 &&
    json.ring.length <= 2000 &&
    json.ring.every(
      (p) =>
        p && typeof p === "object" &&
        Number.isFinite((p as LatLng).lat) && Number.isFinite((p as LatLng).lng)
    )
      ? (json.ring as LatLng[]).map((p) => ({ lat: p.lat, lng: p.lng }))
      : null;

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { ok: false, error: new GoogleMapsConfigError("GOOGLE_MAPS_API_KEY not configured.").message },
      { status: 501 }
    );
  }

  try {
    const target = { lat, lng };
    const params = new URLSearchParams({
      location: `${lat.toFixed(7)},${lng.toFixed(7)}`,
      radius: String(SEARCH_RADIUS_M),
      // Outdoor only — though see below: this does NOT exclude a business's own photosphere.
      source: "outdoor",
      key,
    });
    const res = await fetch(`${METADATA_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    void recordApiCall({ provider: "google", api: "street_view_metadata" });
    const data = (await res.json()) as MetadataResp;
    const nearest =
      data.status === "OK" && data.location?.lat !== undefined && data.location?.lng !== undefined
        ? { lat: data.location.lat, lng: data.location.lng }
        : null;

    // The nearest camera is trusted only when it is Google's OWN, stands OUTSIDE the property,
    // isn't on top of the target — and is ON THE STREET. `source=outdoor` lets a shop's indoor
    // photosphere through, some carry "© Google", and one inside the NEIGHBOURING shop is
    // outside this lot's ring too: that is exactly how 55-59 Bells Line of Road opened inside
    // the barber next door (2026-09-29). A street camera stands in the road reserve, so the
    // cadastre (free, keyless) is the test: a camera inside ANY titled lot is indoors or in a
    // yard. Outside QLD/NSW/VIC the lookup finds nothing and the camera passes, as before.
    // ⚠️ And it must carry a capture DATE. That is what actually caught the barber: its
    // photosphere is "© Google" but pinned to a point ON THE ROAD, so no location test can
    // see it — yet every street-car panorama checked (NSW, QLD, VIC, 2018-2026) has a `date`
    // and it had none.
    const trusted =
      nearest !== null &&
      /google/i.test(data.copyright ?? "") &&
      Boolean(data.date) &&
      !(ring && pointInRing(nearest, ring)) &&
      distanceM(nearest, target) >= MIN_USEFUL_DISTANCE_M &&
      (await onStreet(nearest));
    if (trusted) {
      return NextResponse.json({
        ok: true,
        heading: bearing(nearest, target),
        pano: data.pano_id ?? null,
        panoDate: data.date ?? null,
        distanceM: Math.round(distanceM(nearest, target)),
      });
    }

    // Otherwise the storeys check's camera finder: Google cameras outside the parcel, probed
    // around the target, within MAX_CAMERA_DISTANCE_M of the boundary, nearest first — the
    // first of them standing on the street. All free calls.
    let cam = null;
    for (const c of await findStreetCameras(target, ring, key, 5)) {
      if (await onStreet(c)) {
        cam = c;
        break;
      }
    }
    if (cam) {
      return NextResponse.json({
        ok: true,
        heading: Math.round(cam.heading * 10) / 10,
        pano: cam.pano ?? null,
        distanceM: Math.round(cam.distanceM),
      });
    }

    // Nothing better: the nearest camera, unpinned and unaimed-if-useless — the old behaviour.
    // ZERO_RESULTS is an ordinary answer (plenty of rural and industrial sites have no
    // coverage); ok:true with a null heading means "open it anyway".
    if (!nearest) {
      return NextResponse.json({
        ok: true,
        heading: null,
        reason: data.status === "ZERO_RESULTS" ? "no_coverage" : (data.status ?? "unknown"),
      });
    }
    if (distanceM(nearest, target) < MIN_USEFUL_DISTANCE_M) {
      return NextResponse.json({ ok: true, heading: null, reason: "on_top_of_it" });
    }
    // Not pinned: this camera failed the checks, so Google is left to choose as it always did.
    return NextResponse.json({ ok: true, heading: bearing(nearest, target), pano: null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/** True when the point is NOT inside a titled lot — i.e. a road, a reserve, or somewhere the
 *  cadastre doesn't cover. A cadastre failure counts as "on the street": this is a filter on a
 *  link, and an outage should leave the old behaviour, not a dead button. */
async function onStreet(point: LatLng): Promise<boolean> {
  try {
    const parcel = await parcelAtPointAnyState(point);
    return !parcel || parcel.kind !== "lot";
  } catch {
    return true;
  }
}

function distanceM(from: LatLng, to: LatLng): number {
  const { east, north } = projectToLocalMetres(from, to);
  return Math.hypot(east, north);
}

/** Compass bearing from the camera to the target, clockwise from north — what the `heading`
 *  URL parameter takes. atan2(east, north), NOT atan2(y, x), puts 0 at north and 90 at east. */
function bearing(camera: LatLng, target: LatLng): number {
  const { east, north } = projectToLocalMetres(camera, target);
  const deg = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  return Math.round(deg * 10) / 10;
}
