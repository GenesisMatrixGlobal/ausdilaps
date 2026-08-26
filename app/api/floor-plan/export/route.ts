import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { renderPlan } from "@/lib/floor-plan/render";
import { a4Pixels, floorPlanSchema } from "@/lib/floor-plan/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  plan: floorPlanSchema,
  // 300 for print, 150 for a lighter file to drop into the Word report.
  dpi: z.union([z.literal(150), z.literal(300)]).default(300),
});

export async function POST(req: NextRequest) {
  if (!(await isStaff("FLOOR_PLAN_ALLOW_UNAUTHED", "floor-plan"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid plan.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { plan, dpi } = parsed.data;

  try {
    // The same SVG the client previews. sharp rasterises it at the page's exact pixel size,
    // so the PNG is a true A4 sheet rather than something scaled to fit afterwards.
    const svg = renderPlan(plan, { mode: "export", dpi });
    const page = a4Pixels(dpi, plan.orientation);
    const png = await sharp(Buffer.from(svg), { density: dpi })
      .resize(page.w, page.h, { fit: "fill" })
      .png({ compressionLevel: 9 })
      .toBuffer();

    return NextResponse.json({
      ok: true,
      image: png.toString("base64"),
      width: page.w,
      height: page.h,
    });
  } catch (err) {
    console.error("[floor-plan/export]", err);
    return NextResponse.json({ ok: false, error: "Could not render the plan." }, { status: 500 });
  }
}
