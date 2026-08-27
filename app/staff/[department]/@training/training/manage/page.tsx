import Link from "next/link";
import { notFound } from "next/navigation";
import { requireKnowledgeEditor, isAdmin } from "@/lib/auth/session";
import { getDepartment, isDepartmentSlug, DEPARTMENTS } from "@/lib/departments";
import { listSources } from "@/lib/knowledge/ingest";
import { ManageView } from "./manage-view";

export const metadata = {
  title: "Manage knowledge · AusDilaps Staff",
  robots: { index: false, follow: false },
};

/** Reading a PDF visually takes tens of seconds and runs in after(), which is still
 *  inside this function's lifetime on Vercel. 290 matches the other long routes in
 *  this repo (app/api/tenders/scan, floor-plan/extract). Without it the upload
 *  succeeds and the indexing is killed halfway. */
export const maxDuration = 290;

export default async function ManageKnowledgePage({
  params,
}: {
  params: Promise<{ department: string }>;
}) {
  const { department } = await params;
  if (!isDepartmentSlug(department)) notFound();

  // Bounces anyone without the upload permission for this department to /staff/no-access.
  const user = await requireKnowledgeEditor(department, `/staff/${department}/training/manage`);
  const dept = getDepartment(department)!;
  const admin = isAdmin(user);

  // Admins see everything so they can retag across departments; a contributor sees their
  // own departments plus company-wide, which matches what they can be answered from.
  const sources = await listSources(admin ? "all" : user.departments);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Link
            href={`/staff/${department}/training`}
            className="text-sm font-medium text-ad-steel hover:underline"
          >
            ← {dept.label} training
          </Link>
          <h2 className="mt-3 text-2xl font-semibold text-ad-ink">Manage knowledge</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ad-muted">
            Everything here is searchable from the bar on the Training tab. Upload a file or
            paste the text — or add a video with its transcript.
          </p>
        </div>
      </div>

      <ManageView
        department={department}
        departmentLabel={dept.label}
        sources={sources}
        // Admins can tag anything; a contributor only their own departments.
        assignable={(admin ? DEPARTMENTS.map((d) => d.slug) : user.departments).map((slug) => ({
          slug,
          label: getDepartment(slug)!.label,
        }))}
        canPublishCompanyWide={admin}
      />
    </div>
  );
}
