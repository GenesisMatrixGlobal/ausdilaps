import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { KmzParseError, parseRoadSurveyFile } from "@/lib/road-survey/parse-kmz";
import { roadSurveyParseRequestSchema } from "@/lib/road-survey/schema";

export const runtime = "nodejs";
// Pure parsing, no external calls — this returns in well under a second for a 1,200 km
// network. The generous ceiling is only here for a pathologically large upload.
export const maxDuration = 60;

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

  const parsed = roadSurveyParseRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(parsed.data.file.data, "base64"));
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't decode that file." }, { status: 400 });
  }

  try {
    const result = parseRoadSurveyFile(bytes);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // A KmzParseError is a bad file, which is the operator's problem to fix and so gets a
    // 422 with the real message. Anything else is ours.
    if (e instanceof KmzParseError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
