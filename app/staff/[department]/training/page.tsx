import Link from "next/link";
import { notFound } from "next/navigation";
import { getDepartment, isDepartmentSlug } from "@/lib/departments";
import { getTrainingModules } from "@/lib/training";
import { getStaffUser, canEditKnowledge } from "@/lib/auth/session";
import { CardGrid, LinkCard } from "@/components/staff/card-grid";
import { EmptyState } from "@/components/staff/empty-state";

export default async function DepartmentTrainingPage({
  params,
}: {
  params: Promise<{ department: string }>;
}) {
  const { department } = await params;
  if (!isDepartmentSlug(department)) notFound();

  const dept = getDepartment(department)!;
  const modules = getTrainingModules(department);

  // The layout already established this person can see the department; this only decides
  // whether the Manage link is worth showing them.
  const user = await getStaffUser();
  const canManage = user ? canEditKnowledge(user, [department]) : false;

  const manageLink = canManage ? (
    <Link
      href={`/staff/${department}/training/manage`}
      className="text-sm font-medium text-ad-steel hover:underline"
    >
      Manage knowledge →
    </Link>
  ) : null;

  if (modules.length === 0) {
    return (
      <div className="space-y-5">
        {manageLink && <div className="flex justify-end">{manageLink}</div>}
        <EmptyState
          title={`No ${dept.label} training yet`}
          body={
            canManage
              ? "Add the first document, video or note from Manage knowledge — anything you add can also answer questions in the search bar."
              : "Nothing has been published for this department yet. Ask a company admin or your department lead to add it."
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {manageLink && <div className="flex justify-end">{manageLink}</div>}
      <CardGrid>
        {modules.map((m) => (
          <LinkCard
            key={m.slug}
            href={`/staff/${department}/training/${m.slug}`}
            title={m.title}
            description={m.summary}
            meta={m.duration}
          />
        ))}
      </CardGrid>
    </div>
  );
}
