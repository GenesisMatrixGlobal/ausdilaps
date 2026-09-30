import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { fetchOsmBuildings } from "@/lib/kml/standard-markup/osm-buildings";
import { findSharedHouses } from "@/lib/kml/standard-markup/shared-houses";

export const runtime = "nodejs";
export const maxDuration = 30;

// Which of these lots look like ONE house on two (or more) lots? See
// lib/kml/standard-markup/shared-houses.ts. Always 200: no footprints, or Overpass being
// down, is "no groups", not an error — the markup is fine without the hint.

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const requestSchema = z.object({
  lots: z.array(z.object({ id: z.string().max(80), ring: z.array(latLng).min(3).max(2000) })).min(2).max(120),
});

export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_STANDARD_MARKUP_ALLOW_UNAUTHED", "site-markups"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid input." }, { status: 400 });
  }
  const { lots } = parsed.data;
  const pts = lots.flatMap((l) => l.ring);
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  // A job spread over several suburbs would make one huge query; the check is for adjoining
  // lots, so past ~2 km across it isn't asked at all.
  const spanDeg = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
  if (spanDeg > 0.02) return NextResponse.json({ ok: true, groups: [], reason: "too_spread" });

  const pad = 0.0002; // ~20 m, so a house at the edge of the job is still fetched whole
  const buildings = await fetchOsmBuildings({
    south: Math.min(...lats) - pad,
    west: Math.min(...lngs) - pad,
    north: Math.max(...lats) + pad,
    east: Math.max(...lngs) + pad,
  });
  return NextResponse.json({ ok: true, groups: findSharedHouses(lots, buildings), buildings: buildings.length });
}
