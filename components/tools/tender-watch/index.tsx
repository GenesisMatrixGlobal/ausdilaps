import { isApiAdmin } from "@/lib/auth/is-staff";
import { loadTenderSummary } from "@/lib/tenders/summary";
import { TenderWatchView } from "./view";

/**
 * Tender Watch — the registry entry point.
 *
 * Unlike the other tools, this one is a SERVER component. Those are request/response
 * utilities where every call is user-triggered, so a client component is the right shape.
 * This is a dashboard: it has to show state the moment it opens, and loading it on the
 * server avoids a round trip, a loading flash, and a mount effect.
 *
 * Lives only at /staff/<dept>/tools/tender-watch, via the registry. There is no /admin
 * route: canAccess() grants admins every department, so a second path would just be
 * another way into the same component.
 *
 * The extra operator panels (funnel, run log, upstream errors) are driven by the isAdmin
 * flag in the data rather than by which route rendered it — so an admin opening the
 * ordinary tool page still sees them.
 *
 * The route (and the department layout above it) has already proved the caller may be
 * here; isApiAdmin() only decides how much operator detail to include.
 */
export async function TenderWatchTool() {
  const summary = await loadTenderSummary(await isApiAdmin());
  return <TenderWatchView initial={summary} />;
}
