import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { siteMarkupRequestSchema } from "@/lib/kml/site-markup/schema";
import {
  resolveRoad,
  resolveRoadFromCoords,
  resolveRouteFromWaypoints,
  type ResolveRoadResult,
} from "@/lib/kml/site-markup/resolve-road";
import { CoordinateParseError, parseLatLng } from "@/lib/kml/site-markup/parse-latlng";
import { parseGoogleRouteUrl } from "@/lib/kml/site-markup/parse-route-url";
import { pathLengthKm } from "@/lib/kml/road-segments/geo";
import type { RoadTraceStatus } from "@/lib/kml/road-segments/types";
import sharp from "sharp";
import {
  buildStaticMapUrl,
  GoogleMapsConfigError,
  IMAGE_SIZE,
  SCALE,
  type StaticMapMarker,
} from "@/lib/kml/site-markup/static-map";
import { buildRoadOverlaySvg } from "@/lib/kml/site-markup/overlay";

export const runtime = "nodejs";

/** ad-steel, matching the north arrow — the traced line is orange. */
const PIN_COLOR = "46688a";
const MAX_ROADS_IN_HEADER = 60;

/** Static Maps marker labels are a single character: 1-9, then A onwards. */
function waypointLabel(index: number): string {
  return index < 9 ? String(index + 1) : String.fromCharCode("A".charCodeAt(0) + index - 9);
}
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_ROAD_TRACE_ALLOW_UNAUTHED"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = siteMarkupRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const { color, opacityPercent, mapType, zoomAdjust } = input;

  // Both modes converge on the same thing — an ordered road centerline — so everything
  // below this branch (rendering, error shaping, response) is shared.
  let resolved: ResolveRoadResult;
  let failureMessages: Record<Exclude<RoadTraceStatus, "ok">, string>;
  // Notes raised before tracing (e.g. an auto-corrected lat/lng swap) that still belong
  // on the response alongside anything the tracer flags.
  let inputFlags: string[] = [];
  // Panel heading: the road name, or a route label. Undefined shows distance only.
  let title: string | undefined;
  // Route mode reports Google's own road distance instead of measuring the drawn polyline
  // (`overview_polyline` is simplified, so measuring it under-reports).
  let reportedDistanceKm: number | null = null;
  // Numbered pins, route mode only — the waypoints are the operator's own stops there.
  let markers: StaticMapMarker[] = [];

  if (input.mode === "route_url") {
    title = input.label;
    let points;
    try {
      const parsedRoute = await parseGoogleRouteUrl(input.url);
      points = parsedRoute.points;
      inputFlags = parsedRoute.flags;
    } catch (e) {
      if (e instanceof CoordinateParseError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
      }
      throw e;
    }

    failureMessages = {
      geocode_failed: "Couldn't resolve the waypoints in that link.",
      route_failed:
        "Couldn't trace a road route through those waypoints — check each one sits on a road Google can route between.",
      error: "Something went wrong tracing that route.",
    };

    if (input.showWaypointPins) {
      markers = points.map((point, i) => ({
        point,
        label: waypointLabel(i),
        // The traced line is orange, so orange pins would vanish into it. Blue matches the
        // north arrow instead.
        color: PIN_COLOR,
      }));
    }

    try {
      const routeResult = await resolveRouteFromWaypoints(points);
      resolved = routeResult;
      reportedDistanceKm = routeResult.distanceKm;
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
    }
  } else if (input.mode === "coordinates") {
    title = input.roadName;
    let from, to;
    try {
      const fromParsed = parseLatLng(input.from);
      const toParsed = parseLatLng(input.to);
      from = fromParsed.point;
      to = toParsed.point;
      inputFlags = [
        ...fromParsed.flags.map((f) => `From coordinate: ${f}`),
        ...toParsed.flags.map((f) => `To coordinate: ${f}`),
      ];
    } catch (e) {
      if (e instanceof CoordinateParseError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
      }
      throw e;
    }

    failureMessages = {
      geocode_failed: "Couldn't resolve those coordinates.",
      route_failed:
        "Couldn't trace a road between those two coordinates — check both sit on a road Google knows, and that they're on the same connected stretch.",
      error: "Something went wrong tracing between those coordinates.",
    };

    try {
      resolved = await resolveRoadFromCoords(from, to, input.roadName);
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
    }
  } else {
    const { roadName, fromDesc, toDesc, area } = input;
    title = roadName;
    failureMessages = {
      geocode_failed: `Couldn't locate "${fromDesc}" or "${toDesc}" near ${area} — check the spelling, or add a postcode.`,
      route_failed: `Couldn't trace "${roadName}" between "${fromDesc}" and "${toDesc}" near ${area} — check the cross streets actually meet that road.`,
      error: "Something went wrong tracing that road.",
    };

    try {
      resolved = await resolveRoad(roadName, fromDesc, toDesc, area);
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
    }
  }

  const flags = [...inputFlags, ...resolved.flags];

  if (resolved.status !== "ok") {
    const detail = flags.length > 0 ? ` (${flags.join("; ")})` : "";
    return NextResponse.json(
      { ok: false, error: `${failureMessages[resolved.status]}${detail}` },
      { status: 404 }
    );
  }

  let mapUrl: string;
  try {
    mapUrl = buildStaticMapUrl({
      ways: [resolved.path],
      color,
      opacityPercent,
      mapType,
      zoomAdjust,
      markers,
    }).url;
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

  const mapPng = Buffer.from(await imgRes.arrayBuffer());
  const lengthKm = reportedDistanceKm ?? pathLengthKm(resolved.path);

  // Label panel goes on after the fact — Static Maps has no text overlay of its own.
  let buffer: Buffer;
  try {
    buffer = await sharp(mapPng)
      .composite([
        {
          input: buildRoadOverlaySvg({
            nativeSize: IMAGE_SIZE * SCALE,
            title,
            lengthKm,
            color,
            roads: resolved.roads,
          }),
        },
      ])
      .png()
      .toBuffer();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Couldn't draw the overlay: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      // Traced OK, but flag anything worth a manual check (e.g. an imprecise cross-street
      // geocode) — the image still downloads, this just surfaces the caveat in the UI.
      "X-Trace-Flags": encodeURIComponent(JSON.stringify(flags)),
      // Length of the traced centerline — a cheap sanity check that the markup covers the
      // stretch the operator meant, shown in the UI beside the image.
      "X-Traced-Length-Km": lengthKm.toFixed(3),
      // Full ordered breakdown for the UI to render as copyable text. Capped so a
      // pathological route can't push the response headers over the server's limit.
      "X-Route-Roads": encodeURIComponent(
        JSON.stringify(
          resolved.roads.slice(0, MAX_ROADS_IN_HEADER).map((r) => ({
            name: r.name,
            m: Math.round(r.distanceMeters),
          }))
        )
      ),
    },
  });
}
