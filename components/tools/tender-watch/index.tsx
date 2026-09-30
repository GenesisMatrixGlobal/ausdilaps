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
 * Mounted in TWO places, both rendering this same component: /staff/<dept>/tools/tender-watch
 * via the registry, and /admin/tenders as a Command Centre tab. The second is a DOOR, not a
 * second dashboard — it exists because this is the tool an admin opens daily and the accounts
 * department's tool list is not where anyone looks for it. canAccess() already granted admins
 * the access; what the tab adds is a place in the navigation.
 *
 * ⚠️ Never fork this for the admin route. Anything that should differ between the two doors
 * belongs on the isAdmin flag below, which is read from the session rather than from which
 * route rendered it.
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
