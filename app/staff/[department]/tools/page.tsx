import { notFound } from "next/navigation";
import { getDepartment, isDepartmentSlug } from "@/lib/departments";
import { toolsForDepartment } from "@/lib/tools/registry";
import { CardGrid, LinkCard } from "@/components/staff/card-grid";
import { EmptyState } from "@/components/staff/empty-state";

export default async function DepartmentToolsPage({
  params,
}: {
  params: Promise<{ department: string }>;
}) {
  const { department } = await params;
  if (!isDepartmentSlug(department)) notFound();

  const dept = getDepartment(department)!;
  const tools = toolsForDepartment(department);

  if (tools.length === 0) {
    return (
      <EmptyState
        title={`No tools for ${dept.label} yet`}
        body="Tools get assigned to departments in the tool registry. Ask a company admin if you're expecting something here."
      />
    );
  }

  return (
    <CardGrid>
      {tools.map((tool) => (
        <LinkCard
          key={tool.slug}
          href={`/staff/${department}/tools/${tool.slug}`}
          title={tool.title}
          description={tool.description}
        />
      ))}
    </CardGrid>
  );
}
