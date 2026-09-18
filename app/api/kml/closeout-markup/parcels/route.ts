// Properties → title boundaries. Free and keyless (state cadastres + address layers), so the
// only thing bounding this route is somebody else's server and the function timeout.
//
// ⚠️ With ONE exception: the project site, which Salesforce has not geocoded, so it costs a
// Google geocode per address segment (see lib/closeout-markup/site.ts). A handful per generate.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/auth/is-staff";
import { MAX_CLOSEOUT_LOTS } from "@/lib/closeout-markup/limits";
import { resolveCloseoutParcels } from "@/lib/closeout-markup/parcels";
import { resolveCloseoutSite } from "@/lib/closeout-markup/site";
import type { CloseoutProperty } from "@/lib/closeout-markup/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const propertySchema = z.object({
  key: z.string().min(1).max(200),
  street: z.string().max(240),
  suburb: z.string().max(120).nullable(),
  postcode: z.string().max(10).nullable(),
  state: z.enum(["QLD", "NSW", "VIC", "SA", "WA", "TAS", "ACT", "NT"]).nullable(),
  point: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  precision: z.enum(["precise", "approximate", "area"]),
  sharedPoint: z.boolean(),
  accuracy: z.string().max(60).nullable(),
});

const siteSchema = z.object({
  line: z.string().max(400),
  street: z.string().max(400).nullable(),
  suburb: z.string().max(120).nullable(),
  state: z.enum(["QLD", "NSW", "VIC", "SA", "WA", "TAS", "ACT", "NT"]).nullable(),
  postcode: z.string().max(10).nullable(),
});

const requestSchema = z.object({
  // The same cap the button enforces. Two places, deliberately: the client cap is what the
  // operator is told about, and this one is what stops a 700-property payload timing out the
  // function with nothing to show for it.
  properties: z.array(propertySchema).min(1).max(MAX_CLOSEOUT_LOTS),
  /** The Opportunity's own site address, when it has one. */
  site: siteSchema.nullish(),
});

export async function POST(req: NextRequest) {
  if (!(await isStaff("KML_STANDARD_MARKUP_ALLOW_UNAUTHED", "closeout-markup"))) {
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
    // Only the fields the lookup reads are sent; the rest of CloseoutProperty (counts, colour,
    // work order numbers) stays on the client, where it came from.
    //
    // In parallel: the properties are free cadastre reads and the site is a geocode, so there is
    // nothing to gain by serialising them. ⚠️ The site is allSettled-style — a failure there
    // must not cost the operator the whole drawing, which is the part they actually came for.
    const [parcels, site] = await Promise.all([
      resolveCloseoutParcels(parsed.data.properties as unknown as CloseoutProperty[]),
      parsed.data.site
        ? resolveCloseoutSite(parsed.data.site).catch((e: Error) => ({
            lots: [],
            unresolved: [{ address: parsed.data.site!.line, reason: `Lookup failed — ${e.message}` }],
          }))
        : Promise.resolve({ lots: [], unresolved: [] }),
    ]);
    return NextResponse.json({ ok: true, parcels, site });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
