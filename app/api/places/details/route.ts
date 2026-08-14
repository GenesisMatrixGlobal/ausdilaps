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
}

function componentByType(components: AddressComponent[], type: string): AddressComponent | undefined {
  return components.find((c) => c.types?.includes(type));
}

export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_STANDARD_MARKUP_ALLOW_UNAUTHED"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let json: { placeId?: string; sessionToken?: string };
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

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
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "addressComponents,formattedAddress" },
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

    if (!street || !suburb || !state) {
      return NextResponse.json({
        ok: false,
        error: "Couldn't parse a full street/suburb/state from that address — try entering it manually.",
      });
    }

    return NextResponse.json({ ok: true, street, suburb, postcode, state, formattedAddress: data.formattedAddress ?? null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
