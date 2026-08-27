import Link from "next/link";
import { notFound } from "next/navigation";
import { isDepartmentSlug } from "@/lib/departments";
import { getTool } from "@/lib/tools/registry";
import { ToolFrame } from "@/components/staff/tool-frame";

/** One page file serves every tool, present and future — the tool itself comes
 *  from the registry. */
export async function generateMetadata({ params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  const def = getTool(tool);
  return {
    title: def ? `${def.title} · AusDilaps Staff` : "Staff portal · AusDilaps",
    robots: { index: false, follow: false },
  };
}

export default async function ToolPage({
  params,
}: {
  params: Promise<{ department: string; tool: string }>;
}) {
  const { department, tool: slug } = await params;
  if (!isDepartmentSlug(department)) notFound();

  const tool = getTool(slug);
  // 404 rather than 403 when the tool exists but isn't assigned to this
  // department — the department layout already proved they can be here.
  if (!tool || !tool.departments.includes(department)) notFound();

  const { Component } = tool;

  return (
    <div>
      <Link
        href={`/staff/${department}/tools`}
        className="text-sm font-medium text-ad-steel hover:underline"
      >
        ← All tools
      </Link>
      <div className="mt-4">
        <ToolFrame title={tool.title} code={tool.code} description={tool.description}>
          <Component />
        </ToolFrame>
      </div>
    </div>
  );
}
