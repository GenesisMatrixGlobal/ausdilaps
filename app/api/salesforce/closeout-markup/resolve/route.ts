// Read-only: which opportunity, and every property its work orders name.
//
// No cadastre, no Google, one Salesforce round trip — so this stays fast and free at any job
// size, and the sheet can show a 700-property job in full even though only 60 will be drawn.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { resolveCloseout } from "@/lib/closeout-markup/opportunity";
import { isConfigError, MarkupSyncError } from "@/lib/markup-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  opportunityInput: z.string().trim().min(1, "Paste a Salesforce Opportunity link or Id").max(500),
});

export async function POST(req: NextRequest) {
  if (!(await isStaff("MARKUP_SYNC_ALLOW_UNAUTHED", "closeout-markup"))) {
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
    const result = await resolveCloseout(parsed.data.opportunityInput);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (isConfigError(e)) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 501 });
    }
    if (e instanceof MarkupSyncError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
