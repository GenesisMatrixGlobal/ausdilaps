import Link from "next/link";
import { notFound } from "next/navigation";
import { getDepartment, isDepartmentSlug } from "@/lib/departments";
import { getTrainingModules } from "@/lib/training";
import { getStaffUser, canEditKnowledge } from "@/lib/auth/session";
import { RowList, LinkRow } from "@/components/staff/row-list";
import { KnowledgeSearch } from "@/components/staff/knowledge-search";
import { listDepartmentSources } from "@/lib/knowledge/retrieve";
import { searchDepartmentKnowledge, knowledgeSourceFile } from "./search-action";
import { EmptyState } from "@/components/staff/empty-state";

export default async function DepartmentTrainingPage({
  params,
}: {
  params: Promise<{ department: string }>;
}) {
  const { department } = await params;
  if (!isDepartmentSlug(department)) notFound();

  const dept = getDepartment(department)!;

  // Two sources of truth, deliberately: modules are authored in the repo as MDX,
  // uploads live in the database. Listing only the first is what made a department
  // with real uploaded material report "no training yet".
  const modules = getTrainingModules(department);
  const uploads = await listDepartmentSources(department);

  // The layout already established this person can see the department; this only decides
  // whether the Manage link is worth showing them.
  const user = await getStaffUser();
  const canManage = user ? canEditKnowledge(user, [department]) : false;

  const header = (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Link
            href={`/staff/${department}/training/manage`}
            className="text-sm font-medium text-ad-steel hover:underline"
          >
            Manage knowledge →
          </Link>
        </div>
      )}
      {/* Above the module list, because uploaded documents and video transcripts
          are searchable without ever appearing as a module below. */}
      <KnowledgeSearch
        department={department}
        search={searchDepartmentKnowledge}
        getFile={knowledgeSourceFile}
      />
    </div>
  );

  if (modules.length === 0 && uploads.length === 0) {
    return (
      <div className="space-y-5">
        {header}
        <EmptyState
          title={`No ${dept.label} training yet`}
          body={
            canManage
              ? "Add the first document, video or note from Manage knowledge — anything you add is searchable from the bar above straight away."
              : "Nothing has been published for this department yet. Ask a company admin or your department lead to add it."
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}
      <RowList>
        {modules.map((m) => (
          <LinkRow
            key={m.slug}
            href={`/staff/${department}/training/${m.slug}`}
            title={m.title}
            description={m.summary}
            meta={m.duration ?? "MODULE"}
          />
        ))}
        {uploads.map((u) => (
          <LinkRow
            key={u.id}
            href={u.href}
            title={u.title}
            description={u.summary ?? "Uploaded to the knowledge base."}
            meta={u.badge}
          />
        ))}
      </RowList>
    </div>
  );
}
