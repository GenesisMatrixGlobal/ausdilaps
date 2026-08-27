import { notFound } from "next/navigation";
import { getDepartment, isDepartmentSlug } from "@/lib/departments";
import { toolsForDepartment } from "@/lib/tools/registry";
import { RowList, LinkRow } from "@/components/staff/row-list";
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
    <RowList>
      {tools.map((tool) => (
        <LinkRow
          key={tool.slug}
          href={`/staff/${department}/tools/${tool.slug}`}
          code={tool.code}
          title={tool.title}
          description={tool.description}
        />
      ))}
    </RowList>
  );
}
