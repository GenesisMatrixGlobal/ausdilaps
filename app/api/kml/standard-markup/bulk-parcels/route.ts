// Many addresses → many parcels, for the multi-property markup (Markup and Measure's *DEV*
// tab). Same gate as the rest of the standard-markup routes.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { resolveBulkParcels } from "@/lib/kml/standard-markup/bulk-parcels";

export const runtime = "nodejs";
// Up to 60 geocode + cadastre pairs, five in flight at once.
export const maxDuration = 60;

const requestSchema = z.object({
  text: z.string().trim().min(1, "Paste at least one address").max(20_000),
});

export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_STANDARD_MARKUP_ALLOW_UNAUTHED", "site-markups"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await resolveBulkParcels(parsed.data.text);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
