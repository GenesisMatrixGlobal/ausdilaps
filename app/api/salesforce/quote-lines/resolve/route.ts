// Read-only half of the sheet's Sync to Salesforce: which Quote the operator is about to add
// line items to, and how many it already has. Nothing here mutates Salesforce.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { isConfigError, MarkupSyncError } from "@/lib/markup-sync";
import { resolveQuoteForLines } from "@/lib/quote-lines/resolve";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.object({
  quoteInput: z.string().trim().min(1, "Paste a Salesforce Quote URL, Id or number").max(500),
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
    const { quote } = await resolveQuoteForLines(parsed.data.quoteInput);
    return NextResponse.json({ ok: true, quote });
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
