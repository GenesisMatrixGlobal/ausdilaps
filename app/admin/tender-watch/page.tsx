import { requireAdmin } from "@/lib/auth/session";
import { TenderWatchTool } from "@/components/tools/tender-watch";

/** Admin-only while the pipeline is inert — Tender Watch is deliberately not in the tool
 *  registry, so no staff department sees it. The component is shared with /staff for when
 *  it does go live; the API decides how much operator detail to include. */
export const metadata = {
  title: "Tender Watch · AusDilaps Admin",
  robots: { index: false, follow: false },
};

export default async function AdminTenderWatchPage() {
  await requireAdmin("/admin/tender-watch");

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ad-ink">Tender Watch</h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ad-muted">
        Pipeline health, source status and the classified queue. Company admins only for now — it won&rsquo;t appear in
        the staff portal until the nightly scan is switched on.
      </p>
      <div className="mt-8">
        <TenderWatchTool />
      </div>
    </div>
  );
}
