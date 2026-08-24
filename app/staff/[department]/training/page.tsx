import { notFound } from "next/navigation";
import { getDepartment, isDepartmentSlug } from "@/lib/departments";
import { getTrainingModules } from "@/lib/training";
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

  if (modules.length === 0) {
    return (
      <EmptyState
        title={`No ${dept.label} training yet`}
        body="Training modules are markdown files in the repo under content/training. Ask a company admin to add the first one."
      />
    );
  }

  return (
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
  );
}
