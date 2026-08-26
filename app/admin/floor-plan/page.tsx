import { requireAdmin } from "@/lib/auth/session";
import { FloorPlanTool } from "@/components/tools/floor-plan";

/** Admin-only view of the Floor Plan tool while it's still being built out, mirroring
 *  /admin/tender-watch. Unlike Tender Watch this one IS in the registry (the reports team
 *  can use it at /staff/reports/tools/floor-plan) — the same component is surfaced here so
 *  it can be driven from /admin without a second copy. */
export const metadata = {
  title: "Floor Plan · AusDilaps Admin",
  robots: { index: false, follow: false },
};

export default async function AdminFloorPlanPage() {
  await requireAdmin("/admin/floor-plan");

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ad-ink">Floor Plan</h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ad-muted">
        Turn a photo of the inspector&rsquo;s hand sketch into an A4 floor plan .png for the report.
        Still being built — the photo-range chips and the Salesforce link aren&rsquo;t wired up yet.
        Reports staff have the same tool at{" "}
        <span className="font-medium text-ad-ink">/staff/reports/tools/floor-plan</span>.
      </p>
      <div className="mt-8">
        <FloorPlanTool />
      </div>
    </div>
  );
}
