import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import type { LatLng } from "@/lib/kml/types";
import { buildStaticMapUrl, GoogleMapsConfigError } from "@/lib/kml/site-markup/static-map";
import { simplifyRing } from "@/lib/kml/standard-markup/geometry";
import { resolveStandardMarkup, type StandardMarkupStatus } from "@/lib/kml/standard-markup/resolve";
import { standardMarkupRequestSchema } from "@/lib/kml/standard-markup/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const NEIGHBOUR_FILL = "1d4ed8"; // blue
const NEIGHBOUR_FILL_OPACITY = 50;
const NEIGHBOUR_STROKE_OPACITY = 90;
const ASSET_COLOR = "e8642a"; // safety orange — matches the Site Markup preset
const ASSET_OPACITY = 75;
const ASSET_WEIGHT = 6;

// Google Static Maps caps request URLs around 8192 chars. DCDB/OSM geometry can carry
// redundant near-collinear vertices — simplify before encoding, and if still too long,
// simplify harder + cap neighbour count rather than let the Static Maps fetch 414.
const URL_LENGTH_BUDGET = 7800;
const SIMPLIFY_TOLERANCE_M = 0.4;
const SIMPLIFY_TOLERANCE_M_AGGRESSIVE = 1.5;
const MAX_NEIGHBOURS = 12;

function centroidOf(ring: LatLng[]): LatLng {
  const lat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
  const lng = ring.reduce((s, p) => s + p.lng, 0) / ring.length;
  return { lat, lng };
}

function buildMap(
  subjectRing: LatLng[],
  neighbourRings: LatLng[][],
  assets: LatLng[][],
  mapType: "satellite" | "hybrid" | "roadmap",
  zoomAdjust: number,
  tolerance: number,
  neighbourCap: number
): { url: string; omittedNeighbours: number } {
  const subjectCentroid = centroidOf(subjectRing);
  const kept = neighbourRings.length > neighbourCap
    ? [...neighbourRings]
        .sort((a, b) => {
          const da = Math.hypot(centroidOf(a).lat - subjectCentroid.lat, centroidOf(a).lng - subjectCentroid.lng);
          const db = Math.hypot(centroidOf(b).lat - subjectCentroid.lat, centroidOf(b).lng - subjectCentroid.lng);
          return da - db;
        })
        .slice(0, neighbourCap)
    : neighbourRings;

  const url = buildStaticMapUrl({
    ways: assets.map((way) => simplifyRing(way, tolerance)),
    color: ASSET_COLOR,
    opacityPercent: ASSET_OPACITY,
    weight: ASSET_WEIGHT,
    mapType,
    zoomAdjust,
    polygons: kept.map((ring) => ({
      ring: simplifyRing(ring, tolerance),
      fillColor: NEIGHBOUR_FILL,
      fillOpacityPercent: NEIGHBOUR_FILL_OPACITY,
      strokeColor: NEIGHBOUR_FILL,
      strokeOpacityPercent: NEIGHBOUR_STROKE_OPACITY,
    })),
  });

  return { url, omittedNeighbours: neighbourRings.length - kept.length };
}

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

  const parsed = standardMarkupRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { street, suburb, postcode, state, mapType, zoomAdjust } = parsed.data;

  let resolved;
  try {
    resolved = await resolveStandardMarkup({ street, suburb, postcode }, state);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }

  if (resolved.status !== "ok") {
    const messages: Record<Exclude<StandardMarkupStatus, "ok">, string> = {
      not_found: `Couldn't find "${street}, ${suburb}" — check the spelling, or add a postcode.`,
      no_parcel: `Found the address but no titled parcel there — measure manually.`,
      error: "Something went wrong looking up that address.",
    };
    const detail = resolved.flags.length > 0 ? ` (${resolved.flags.join("; ")})` : "";
    return NextResponse.json({ ok: false, error: `${messages[resolved.status]}${detail}` }, { status: 404 });
  }

  let mapUrl: string;
  const extraFlags: string[] = [];
  try {
    let built = buildMap(resolved.subjectRing, resolved.neighbourRings, resolved.assets, mapType, zoomAdjust, SIMPLIFY_TOLERANCE_M, MAX_NEIGHBOURS);
    if (built.url.length > URL_LENGTH_BUDGET) {
      built = buildMap(
        resolved.subjectRing,
        resolved.neighbourRings,
        resolved.assets,
        mapType,
        zoomAdjust,
        SIMPLIFY_TOLERANCE_M_AGGRESSIVE,
        Math.min(MAX_NEIGHBOURS, 8)
      );
    }
    if (built.omittedNeighbours > 0) {
      extraFlags.push(`${built.omittedNeighbours} neighbour lot(s) omitted to fit the map — verify boundaries on site`);
    }
    mapUrl = built.url;
  } catch (e) {
    if (e instanceof GoogleMapsConfigError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 501 });
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const imgRes = await fetch(mapUrl);
  if (!imgRes.ok) {
    const text = await imgRes.text().catch(() => "");
    return NextResponse.json(
      { ok: false, error: `Google Static Maps request failed (${imgRes.status}). ${text.slice(0, 200)}` },
      { status: 502 }
    );
  }

  const buffer = Buffer.from(await imgRes.arrayBuffer());
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "X-Trace-Flags": encodeURIComponent(JSON.stringify([...resolved.flags, ...extraFlags])),
    },
  });
}
