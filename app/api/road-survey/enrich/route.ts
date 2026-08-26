import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { enrichSegments } from "@/lib/road-survey/enrich";
import { KmzParseError, parseRoadSurveyFile } from "@/lib/road-survey/parse-kmz";
import { roadSurveyEnrichRequestSchema } from "@/lib/road-survey/schema";

export const runtime = "nodejs";
// Six-to-eight sequential Overpass tile queries plus 123 reverse geocodes. Measured at
// roughly a minute on the Ferrovial network; the ceiling matches the other heavy tool
// routes (road-segments/trace, site-plan/measure).
export const maxDuration = 290;

export async function POST(req: NextRequest) {
  if (!(await isStaff("ROAD_SURVEY_ALLOW_UNAUTHED"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = roadSurveyEnrichRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const { segments } = parseRoadSurveyFile(new Uint8Array(Buffer.from(parsed.data.file.data, "base64")));
    // enrichSegments never throws for a failed lookup — it collects warnings and returns
    // assumed lanes instead, so a dead Overpass node degrades the result rather than
    // costing the estimator the priced rows they already have on screen.
    const report = await enrichSegments(segments);
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    if (e instanceof KmzParseError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
