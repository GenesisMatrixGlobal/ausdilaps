import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { kmlRequestSchema } from "@/lib/kml/schema";
import { buildKml } from "@/lib/kml/build";

export const runtime = "nodejs";

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "paths"
  );
}

// Gated like every other admin tool route. This was deliberately left open while there
// was no admin login to gate it with; the shared-password gate now exists and the app is
// deployed on a public domain, which is exactly the condition the old TODO waited for.
export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_BUILDER_ALLOW_UNAUTHED", "kml-builder"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = kmlRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { documentName, paths } = parsed.data;
  const kml = buildKml(paths, documentName);
  const filename = `${slugify(documentName)}.kml`;

  return new NextResponse(kml, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.google-earth.kml+xml",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
