import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { GoogleMapsConfigError, renderMeasureExport } from "@/lib/maps/measure-export";

export const runtime = "nodejs";
// A Static Maps fetch plus one sharp composite. Generous, because a cold lambda plus a
// slow Google response is the realistic worst case, not the render itself.
export const maxDuration = 30;

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

const bodySchema = z.object({
  center: latLng,
  zoom: z.number().int().min(1).max(21),
  // Bounded so a hand-rolled request can't ask for an absurd frame; the renderer clamps
  // to Google's 640-point cap regardless.
  viewportWidth: z.number().min(100).max(6000),
  viewportHeight: z.number().min(100).max(6000),
  mapType: z.enum(["satellite", "hybrid", "roadmap"]),
  measurements: z
    .array(
      z.object({
        id: z.string().max(64),
        mode: z.enum(["line", "area"]),
        widthMetres: z.number().min(0.5).max(100),
        points: z.array(latLng).max(200),
      })
    )
    .max(24),
});

export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_STANDARD_MARKUP_ALLOW_UNAUTHED", "site-markups"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 }
    );
  }

  try {
    const result = await renderMeasureExport(parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // A missing/misconfigured key is a setup problem with one fix, so it keeps its own
    // message and a 501 rather than reading as a transient failure.
    if (e instanceof GoogleMapsConfigError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 501 });
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
