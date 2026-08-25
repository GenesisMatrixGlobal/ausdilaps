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
 * Renders in two places from this one definition — /staff/<dept>/tools/tender-watch via
 * the registry, and /admin/tender-watch. The extra operator panels are driven by the
 * isAdmin flag in the data, not by a second copy of the UI.
 *
 * The route (and the department layout above it) has already proved the caller may be
 * here; isApiAdmin() only decides how much operator detail to include.
 */
export async function TenderWatchTool() {
  const summary = await loadTenderSummary(await isApiAdmin());
  return <TenderWatchView initial={summary} />;
}
