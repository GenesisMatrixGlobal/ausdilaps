import { requireAdmin } from "@/lib/auth/session";
import { TenderWatchTool } from "@/components/tools/tender-watch";

export const metadata = {
  title: "Tenders · AusDilaps Admin",
  robots: { index: false, follow: false },
};

/**
 * Tender Watch as a Command Centre tab.
 *
 * ⚠️ This renders the SAME component as the staff tool page — it is a second DOOR, never a
 * second dashboard. Tender Watch is the one tool an admin opens daily, and reaching it meant
 * leaving the Command Centre for the accounts department's tool list, which is not where
 * anyone would look for it. The queue tile on the overview links here.
 *
 * The comment in `components/tools/tender-watch/index.tsx` used to say there was deliberately
 * no /admin route, on the grounds that canAccess() already grants admins every department. It
 * was right that a second path adds no ACCESS; what it adds is a place in the navigation, and
 * that turned out to be worth a four-line page.
 *
 * Copying the component here instead would be the actual mistake — two tender dashboards
 * drifting apart is exactly the "never copy a tool" rule in CLAUDE.md. Anything that should
 * differ between the two doors belongs on the operator flag the tool already reads.
 */
export default async function AdminTendersPage() {
  // The layout has already done this; calling it again keeps the page honest on its own,
  // the way every /admin server action re-checks rather than trusting its caller.
  await requireAdmin("/admin/tenders");
  return <TenderWatchTool />;
}
