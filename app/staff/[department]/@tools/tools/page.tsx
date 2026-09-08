import { notFound } from "next/navigation";
import { getDepartment, isDepartmentSlug } from "@/lib/departments";
import { games, toolsForDepartment } from "@/lib/tools/registry";
import { RowList, LinkRow } from "@/components/staff/row-list";
import { EmptyState } from "@/components/staff/empty-state";

/**
 * Two sections: this department's tools, then the games every department gets.
 *
 * The games list is identical on all five department pages — that is what `kind: "game"` in
 * the registry means, and it needs no per-department configuration and no database state.
 *
 * The empty state lives INSIDE the tools section rather than returning early, so a department
 * with no tools assigned still gets the games section rather than a bare "nothing here".
 */
export default async function DepartmentToolsPage({
  params,
}: {
  params: Promise<{ department: string }>;
}) {
  const { department } = await params;
  if (!isDepartmentSlug(department)) notFound();

  const dept = getDepartment(department)!;
  const tools = toolsForDepartment(department);
  const gameList = games();

  return (
    <div className="space-y-8">
      <section>
        <SectionHeading>Tools</SectionHeading>
        {tools.length === 0 ? (
          <EmptyState
            title={`No tools for ${dept.label} yet`}
            body="Tools get assigned to departments in the tool registry. Ask a company admin if you're expecting something here."
          />
        ) : (
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
        )}
      </section>

      {gameList.length > 0 && (
        <section>
          <SectionHeading>Games &amp; Activities</SectionHeading>
          <RowList>
            {gameList.map((game) => (
              <LinkRow
                key={game.slug}
                href={`/staff/${department}/tools/${game.slug}`}
                code={game.code}
                title={game.title}
                description={game.description}
                // LinkRow already renders `meta` as an uppercase badge — the same prop the
                // training list uses for MODULE. No new component needed for the tag.
                meta="Game"
              />
            ))}
          </RowList>
        </section>
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ad-muted">
      {children}
    </h2>
  );
}
