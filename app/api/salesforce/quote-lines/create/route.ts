// Write half of the sheet's Sync to Salesforce: one QuoteLineItem per ticked row, all or
// nothing.
//
// The server re-resolves the Quote and its price book itself and rebuilds every record from the
// row VALUES — it never accepts a PricebookEntryId or a Product2Id from the client. If any row
// is refused, the response is a 400 listing why and NOTHING is created: a Quote with half a
// sheet on it is worse than one with none, because the half looks finished.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { isConfigError, MarkupSyncError } from "@/lib/markup-sync";
import { createRecords } from "@/lib/salesforce";
import { resolveQuoteForLines } from "@/lib/quote-lines/resolve";
import { buildQuoteLineItems } from "@/lib/quote-lines/payload";

export const runtime = "nodejs";
export const maxDuration = 60;

const cell = z.string().max(200);
const rowSchema = z.object({
  key: z.string().min(1).max(200),
  values: z.object({
    street: cell,
    suburb: cell,
    product: cell,
    assetType: cell,
    internalMetres: cell,
    externalMetres: cell,
    internalRate: cell,
    externalRate: cell,
    quantity: cell,
  }),
});

const requestSchema = z.object({
  quoteId: z.string().regex(/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/, "Not a Salesforce Id"),
  rows: z.array(rowSchema).min(1, "Tick at least one row").max(200),
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
    const { quote, pricebookEntryByProduct2Id } = await resolveQuoteForLines(parsed.data.quoteId);
    const { records, refused } = buildQuoteLineItems(parsed.data.rows, {
      quoteId: quote.id,
      pricebookEntryByProduct2Id,
    });
    if (refused.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `${refused.length} row${refused.length === 1 ? "" : "s"} can't be synced — nothing was created.`,
          refused,
        },
        { status: 400 }
      );
    }
    const created = await createRecords("QuoteLineItem", records);
    return NextResponse.json({
      ok: true,
      result: {
        created: created.map((c, i) => ({ key: parsed.data.rows[i].key, id: c.id })),
        quoteUrl: quote.url,
      },
    });
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
