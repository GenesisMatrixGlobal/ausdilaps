import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { siteMarkupRequestSchema } from "@/lib/kml/site-markup/schema";
import { resolveRoad } from "@/lib/kml/site-markup/resolve-road";
import type { RoadTraceStatus } from "@/lib/kml/road-segments/types";
import { buildStaticMapUrl, GoogleMapsConfigError } from "@/lib/kml/site-markup/static-map";

export const runtime = "nodejs";
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

  const { roadName, fromDesc, toDesc, area, color, opacityPercent, mapType, zoomAdjust } = parsed.data;

  let resolved;
  try {
    resolved = await resolveRoad(roadName, fromDesc, toDesc, area);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }

  if (resolved.status !== "ok") {
    const messages: Record<Exclude<RoadTraceStatus, "ok">, string> = {
      geocode_failed: `Couldn't locate "${fromDesc}" or "${toDesc}" near ${area} — check the spelling, or add a postcode.`,
      route_failed: `Couldn't trace "${roadName}" between "${fromDesc}" and "${toDesc}" near ${area} — check the cross streets actually meet that road.`,
      error: "Something went wrong tracing that road.",
    };
    const detail = resolved.flags.length > 0 ? ` (${resolved.flags.join("; ")})` : "";
    return NextResponse.json({ ok: false, error: `${messages[resolved.status]}${detail}` }, { status: 404 });
  }

  let mapUrl: string;
  try {
    mapUrl = buildStaticMapUrl({ ways: [resolved.path], color, opacityPercent, mapType, zoomAdjust });
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
      // Traced OK, but flag anything worth a manual check (e.g. an imprecise cross-street
      // geocode) — the image still downloads, this just surfaces the caveat in the UI.
      "X-Trace-Flags": encodeURIComponent(JSON.stringify(resolved.flags)),
    },
  });
}
