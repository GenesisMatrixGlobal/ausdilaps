import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { recordApiCall } from "@/lib/api-usage";
import { nearestCbd } from "@/lib/maps/cbds";

export const runtime = "nodejs";
export const maxDuration = 15;

// How far a job is from the nearest CBD, and how long the drive is (Rhys, 2026-09-30: "so we
// don't have to leave and measure the distance ourselves"). ONE Google Directions call —
// origin the CBD, destination the site, driving, no traffic model — ~0.5c, inside the 10k free
// tier, logged on /admin/usage. A Directions miss (no road route, an island) still answers
// with the straight-line km and no time: an ordinary answer, never an error.

const DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json";

interface DirectionsResponse {
  status: string;
  routes?: { legs?: { distance?: { value: number }; duration?: { value: number } }[] }[];
}

export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_STANDARD_MARKUP_ALLOW_UNAUTHED", "site-markups"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { lat?: unknown; lng?: unknown } | null;
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ ok: false, error: "Invalid coordinates." }, { status: 400 });
  }

  const { cbd, straightKm } = nearestCbd({ lat, lng });
  const straight = { ok: true, cbd: cbd.name, km: Math.round(straightKm * 10) / 10, minutes: null, road: false };
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return NextResponse.json(straight);

  try {
    const url = new URL(DIRECTIONS_URL);
    url.searchParams.set("origin", `${cbd.point.lat},${cbd.point.lng}`);
    url.searchParams.set("destination", `${lat.toFixed(6)},${lng.toFixed(6)}`);
    url.searchParams.set("mode", "driving");
    url.searchParams.set("region", "au");
    url.searchParams.set("key", key);
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    void recordApiCall({ provider: "google", api: "directions" });
    const data = (await res.json()) as DirectionsResponse;
    const leg = data.status === "OK" ? data.routes?.[0]?.legs?.[0] : undefined;
    if (!leg?.distance || !leg.duration) return NextResponse.json(straight);
    return NextResponse.json({
      ok: true,
      cbd: cbd.name,
      km: Math.round(leg.distance.value / 100) / 10,
      minutes: Math.round(leg.duration.value / 60),
      road: true,
    });
  } catch {
    return NextResponse.json(straight);
  }
}
