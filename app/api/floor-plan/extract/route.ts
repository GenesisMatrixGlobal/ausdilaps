import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { extractFloorPlan, visionConfigured } from "@/lib/floor-plan/extract";

export const runtime = "nodejs";
// Opus reading a whole layout runs ~50s on the reference sketch; the default ceiling would
// cut it off well before it returns.
export const maxDuration = 290;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const bodySchema = z.object({
  image: z.string().min(1),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
});

export async function POST(req: NextRequest) {
  if (!(await isStaff("FLOOR_PLAN_ALLOW_UNAUTHED"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  if (!visionConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Sketch reading is not configured on this environment. Build the plan by hand instead." },
      { status: 503 }
    );
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
      { ok: false, error: "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // base64 inflates by 4/3; check the decoded size so the limit means what it says.
  if ((parsed.data.image.length * 3) / 4 > MAX_IMAGE_BYTES) {
    return NextResponse.json({ ok: false, error: "Image is too large (8MB max)." }, { status: 413 });
  }

  try {
    const plan = await extractFloorPlan(parsed.data.image, parsed.data.mediaType);
    return NextResponse.json({ ok: true, plan });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read that sketch.";
    console.error("[floor-plan/extract]", message);
    // Upstream errors can carry key fragments and raw request echoes — don't relay them.
    const safe = message.startsWith("Anthropic API") ? "Sketch reading failed. Try again." : message;
    return NextResponse.json({ ok: false, error: safe }, { status: 502 });
  }
}
