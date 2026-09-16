// Read half of the Cover Photo sync: finds the Survey, its Opportunity and the Box folder the
// cover photo will be filed into, so the operator confirms the job before anything is written.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { CoverPhotoSyncError, isConfigError, resolveSurveyTarget } from "@/lib/cover-photo/sync";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.object({
  surveyInput: z.string().trim().min(1, "Paste the Salesforce Survey URL").max(500),
  boxFolderUrl: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest) {
  if (!(await isStaff("COVER_PHOTO_ALLOW_UNAUTHED"))) {
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
    const target = await resolveSurveyTarget({
      surveyInput: parsed.data.surveyInput,
      boxFolderOverrideUrl: parsed.data.boxFolderUrl,
    });
    return NextResponse.json({ ok: true, target });
  } catch (e) {
    if (isConfigError(e)) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 501 });
    }
    if (e instanceof CoverPhotoSyncError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
