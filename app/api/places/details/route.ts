import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { GoogleMapsConfigError } from "@/lib/kml/site-markup/static-map";

export const runtime = "nodejs";
export const maxDuration = 15;

interface AddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}
interface PlaceDetailsResp {
  addressComponents?: AddressComponent[];
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  viewport?: {
    low?: { latitude?: number; longitude?: number };
    high?: { latitude?: number; longitude?: number };
  };
}

function componentByType(components: AddressComponent[], type: string): AddressComponent | undefined {
  return components.find((c) => c.types?.includes(type));
}

export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_STANDARD_MARKUP_ALLOW_UNAUTHED"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let json: { placeId?: string; sessionToken?: string; requireAddress?: boolean };
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  // Defaults TRUE, so the Residential tab's request body and its behaviour are unchanged.
  // The Measure tab opts out: it only recentres a map, which works perfectly well for a
  // suburb, a park, or a road with no street number.
  const requireAddress = json.requireAddress !== false;

  const placeId = json.placeId?.trim();
  if (!placeId) {
    return NextResponse.json({ ok: false, error: "Missing placeId." }, { status: 400 });
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { ok: false, error: new GoogleMapsConfigError("GOOGLE_MAPS_API_KEY not configured.").message },
      { status: 501 }
    );
  }

  try {
    const url = new URL(`https://places.googleapis.com/v1/places/${placeId}`);
    if (json.sessionToken) url.searchParams.set("sessionToken", json.sessionToken);
    const res = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": key,
        // location and viewport sit in the same Place Details ESSENTIALS SKU as
        // addressComponents, and billing is at the highest tier in the mask — so adding
        // them to give the Measure tab a coordinate costs nothing.
        "X-Goog-FieldMask": "addressComponents,formattedAddress,location,viewport",
      },
    });
    const data = (await res.json()) as PlaceDetailsResp & { error?: { message?: string } };
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: data.error?.message ?? `Place details failed (${res.status})` },
        { status: 502 }
      );
    }

    const components = data.addressComponents ?? [];
    const streetNumber = componentByType(components, "street_number")?.longText ?? "";
    const route = componentByType(components, "route")?.longText ?? "";
    const suburb =
      componentByType(components, "locality")?.longText ??
      componentByType(components, "sublocality")?.longText ??
      "";
    const postcode = componentByType(components, "postal_code")?.longText ?? "";
    const state = componentByType(components, "administrative_area_level_1")?.shortText ?? "";
    const street = [streetNumber, route].filter(Boolean).join(" ");

    // Load-bearing for the Residential tab: it is what tells the estimator the cadastre
    // lookup is going to fail and to type the address by hand. Returning ok:true with an
    // empty street would push the same failure one step later with a worse message.
    if (requireAddress && (!street || !suburb || !state)) {
      return NextResponse.json({
        ok: false,
        error: "Couldn't parse a full street/suburb/state from that address — try entering it manually.",
      });
    }

    const loc = data.location;
    const vp = data.viewport;
    // Additive — the Residential tab destructures four fields and ignores the rest.
    return NextResponse.json({
      ok: true,
      street,
      suburb,
      postcode,
      state,
      formattedAddress: data.formattedAddress ?? null,
      location:
        loc?.latitude !== undefined && loc?.longitude !== undefined
          ? { lat: loc.latitude, lng: loc.longitude }
          : null,
      viewport:
        vp?.low?.latitude !== undefined &&
        vp?.low?.longitude !== undefined &&
        vp?.high?.latitude !== undefined &&
        vp?.high?.longitude !== undefined
          ? { south: vp.low.latitude, west: vp.low.longitude, north: vp.high.latitude, east: vp.high.longitude }
          : null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
