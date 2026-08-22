// Read-only half of Sync To Salesforce: works out which Quote, Opportunity and Box folder
// the operator is about to file a markup into, so they can confirm before anything is
// written. Nothing here mutates Salesforce or Box.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { isConfigError, MarkupSyncError, resolveQuoteTarget } from "@/lib/markup-sync";

export const runtime = "nodejs";
// Salesforce token + query, then a Box token and up to two folder listings.
export const maxDuration = 60;

const requestSchema = z.object({
  quoteInput: z.string().trim().min(1, "Paste a Salesforce Quote URL, Id or number").max(500),
  /** Set on the second attempt, when the folder convention didn't resolve. */
  boxFolderUrl: z.string().trim().max(1000).optional(),
});

export async function POST(req: NextRequest) {
  if (!(await isStaff("MARKUP_SYNC_ALLOW_UNAUTHED"))) {
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
    const target = await resolveQuoteTarget({
      quoteInput: parsed.data.quoteInput,
      boxFolderOverrideUrl: parsed.data.boxFolderUrl,
    });
    return NextResponse.json({ ok: true, target });
  } catch (e) {
    // 501 for "not set up yet" matches how the markup routes report a missing Google key —
    // it's a deployment gap, not a bad request.
    if (isConfigError(e)) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 501 });
    }
    if (e instanceof MarkupSyncError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
