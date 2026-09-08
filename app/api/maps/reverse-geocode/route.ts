import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { GoogleMapsConfigError } from "@/lib/kml/site-markup/static-map";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * A coordinate in, an address out — so pasting a Google Maps link into the Building Markup
 * address box fills the same four fields a Places pick does.
 *
 * Server-side because the Geocoding API rejects a referrer-restricted key outright, so this has
 * to use GOOGLE_MAPS_API_KEY (Application restrictions = None) and can never be called from the
 * browser directly. Deliberately mirrors /api/places/details' RESPONSE SHAPE, so the tab has one
 * handler for "an address arrived" rather than two.
 *
 * No URL is fetched on the client's behalf — the only thing that leaves here is an address for a
 * lat/lng the caller already had.
 */

const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

interface Component {
  long_name?: string;
  short_name?: string;
  types?: string[];
}
interface GeocodeResult {
  address_components?: Component[];
  formatted_address?: string;
  types?: string[];
}
interface GeocodeResp {
  status: string;
  error_message?: string;
  results?: GeocodeResult[];
}

/** Same precision bar as lib/property-sizing/google-geocode.ts: a suburb- or state-level hit is
 *  not an address, and feeding one to the cadastre yields a convincing-looking random parcel. */
const PRECISE_TYPES = new Set(["street_address", "premise", "subpremise"]);

function byType(components: Component[], type: string): Component | undefined {
  return components.find((c) => c.types?.includes(type));
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
      latlng: `${lat.toFixed(7)},${lng.toFixed(7)}`,
      region: "au",
      key,
    });
    const res = await fetch(`${GOOGLE_GEOCODE_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const data = (await res.json()) as GeocodeResp;

    if (data.status === "ZERO_RESULTS" || !data.results?.length) {
      return NextResponse.json({ ok: false, error: "No address at that location." });
    }
    if (data.status !== "OK") {
      return NextResponse.json(
        { ok: false, error: `Google geocode ${data.status}${data.error_message ? `: ${data.error_message}` : ""}` },
        { status: 502 }
      );
    }

    // Reverse geocoding returns a LADDER, finest first but not guaranteed — street address,
    // then street, suburb, postcode, state, country. Take the finest entry rather than [0].
    const top = data.results.find((r) => (r.types ?? []).some((t) => PRECISE_TYPES.has(t)));
    if (!top) {
      return NextResponse.json({
        ok: false,
        error: "That point resolved to an area rather than a street address — enter it manually.",
      });
    }

    const components = top.address_components ?? [];
    const streetNumber = byType(components, "street_number")?.long_name ?? "";
    const route = byType(components, "route")?.long_name ?? "";
    const suburb =
      byType(components, "locality")?.long_name ?? byType(components, "sublocality")?.long_name ?? "";
    const postcode = byType(components, "postal_code")?.long_name ?? "";
    const state = byType(components, "administrative_area_level_1")?.short_name ?? "";
    const street = [streetNumber, route].filter(Boolean).join(" ");

    if (!street || !suburb || !state) {
      return NextResponse.json({
        ok: false,
        error: "Couldn't read a full street/suburb/state from that point — enter the address manually.",
      });
    }

    return NextResponse.json({
      ok: true,
      street,
      suburb,
      postcode,
      state,
      formattedAddress: top.formatted_address ?? null,
      // Echoed back rather than taken from the geocoder, so the Street View target is the point
      // the operator actually pasted.
      location: { lat, lng },
      viewport: null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
