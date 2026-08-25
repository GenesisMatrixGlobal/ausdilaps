import { NextResponse } from "next/server";
import { isApiAdmin, isStaffInAnyDepartment } from "@/lib/auth/is-staff";
import { TENDER_WATCH_ALLOW_UNAUTHED_ENV, TENDER_WATCH_DEPARTMENTS } from "@/lib/tenders/config";
import { loadTenderSummary } from "@/lib/tenders/summary";

/**
 * Refresh endpoint for the Tender Watch UI.
 *
 * The initial render loads server-side in the component itself; this exists so the client
 * can refresh after a manual scan without a full page reload.
 *
 * Department-gated rather than using the plain isStaff() gate the estimating tools use:
 * this is the list of what AusDilaps is chasing, plus the model's candid reasoning about
 * why we would lose one, so it is scoped to the departments the tool is assigned to.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST() {
  // Company admins are checked FIRST and independently. TENDER_WATCH_DEPARTMENTS is empty
  // while the pipeline is inert, and isStaffInAnyDepartment([]) is false for everyone — so
  // without this an admin would be locked out of the very screen they own.
  const admin = await isApiAdmin();
  const allowed =
    admin || (await isStaffInAnyDepartment(TENDER_WATCH_DEPARTMENTS, TENDER_WATCH_ALLOW_UNAUTHED_ENV));

  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  try {
    const summary = await loadTenderSummary(admin);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    const error = (e as Error).message;
    console.error("[tenders] summary failed:", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
