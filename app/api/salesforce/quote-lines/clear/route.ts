// Clear a Quote: delete its line items, blank its Site Mark Up slots. See lib/quote-lines/clear.ts
// for why this is safe enough to offer and what it deliberately does NOT touch (the Box files).
//
// Takes a Quote ID ONLY — never a pasted URL or number. The client has already resolved the
// Quote through /resolve and shown the operator its number, its Opportunity and what is on it,
// so a mistyped reference cannot reach a Quote nobody looked at.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { isConfigError, MarkupSyncError } from "@/lib/markup-sync";
import { clearQuote } from "@/lib/quote-lines/clear";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  quoteId: z.string().regex(/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/, "Not a Salesforce Id"),
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
    const result = await clearQuote(parsed.data.quoteId);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    if (isConfigError(e)) return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 501 });
    if (e instanceof MarkupSyncError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
