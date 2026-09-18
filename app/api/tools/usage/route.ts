import { NextRequest, NextResponse } from "next/server";
import { isStaff } from "@/lib/auth/is-staff";
import { getTool } from "@/lib/tools/registry";
import { loadToolUsage } from "@/lib/admin/api-usage";

export const runtime = "nodejs";
export const maxDuration = 15;

// One tool's API spend, month to date — for the counter a tool shows inside itself
// (components/tools/shared/tool-spend.tsx). The same rows /admin/usage reads, filtered to one
// tool, so the two can never disagree. Any signed-in staff member may read it: a spend figure
// for a tool they can already use is not a secret, and seeing it is what makes the cost real.

export async function GET(req: NextRequest) {
  if (!(await isStaff("TOOL_USAGE_ALLOW_UNAUTHED"))) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }
  const slug = req.nextUrl.searchParams.get("tool") ?? "";
  if (!getTool(slug)) {
    return NextResponse.json({ ok: false, error: "Unknown tool." }, { status: 400 });
  }
  try {
    const usage = await loadToolUsage(slug);
    return NextResponse.json({ ok: true, ...usage });
  } catch (e) {
    // A missing table or an unreachable database is a blank counter, not a broken tool.
    console.warn("[tools/usage]", (e as Error).message);
    return NextResponse.json({ ok: false, error: "Usage unavailable." }, { status: 503 });
  }
}
