import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { GoogleMapsConfigError } from "@/lib/kml/site-markup/static-map";

export const runtime = "nodejs";
export const maxDuration = 15;

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";

interface GooglePlacesAutocompleteResp {
  suggestions?: {
    placePrediction?: { placeId?: string; text?: { text?: string } };
  }[];
}

export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_STANDARD_MARKUP_ALLOW_UNAUTHED"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let json: { input?: string; sessionToken?: string };
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const input = json.input?.trim();
  if (!input) {
    return NextResponse.json({ ok: true, suggestions: [] });
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { ok: false, error: new GoogleMapsConfigError("GOOGLE_MAPS_API_KEY not configured.").message },
      { status: 501 }
    );
  }

  try {
    const res = await fetch(AUTOCOMPLETE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
      body: JSON.stringify({
        input,
        sessionToken: json.sessionToken,
        includedRegionCodes: ["au"],
      }),
    });
    const data = (await res.json()) as GooglePlacesAutocompleteResp & { error?: { message?: string } };
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: data.error?.message ?? `Places autocomplete failed (${res.status})` },
        { status: 502 }
      );
    }
    const suggestions = (data.suggestions ?? [])
      .map((s) => ({ placeId: s.placePrediction?.placeId, text: s.placePrediction?.text?.text }))
      .filter((s): s is { placeId: string; text: string } => Boolean(s.placeId && s.text));
    return NextResponse.json({ ok: true, suggestions });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
