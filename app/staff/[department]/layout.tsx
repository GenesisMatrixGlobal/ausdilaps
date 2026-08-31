import { notFound } from "next/navigation";
import { getDepartment, isDepartmentSlug } from "@/lib/departments";
import { requireDepartment } from "@/lib/auth/session";
import { Container } from "@/components/marketing/container";
import { DepartmentTabs } from "@/components/staff/department-tabs";
import { DepartmentPanes } from "@/components/staff/department-panes";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ department: string }>;
}) {
  const { department } = await params;
  const dept = getDepartment(department);
  return {
    title: dept ? `${dept.label} · AusDilaps Staff` : "Staff portal · AusDilaps",
    robots: { index: false, follow: false },
  };
}

/** Tools and Training arrive as parallel-route slots rather than as `children`
 *  so that toggling between them keeps both mounted — see DepartmentPanes. */
export default async function DepartmentLayout({
  params,
  children,
  tools,
  training,
}: {
  params: Promise<{ department: string }>;
  children: React.ReactNode;
  tools: React.ReactNode;
  training: React.ReactNode;
}) {
  const { department } = await params;
  if (!isDepartmentSlug(department)) notFound();

  // Redirects to /staff/no-access if this person's departments don't include it.
  await requireDepartment(department, `/staff/${department}`);
  const dept = getDepartment(department)!;

  return (
    <>
      <div className="border-b border-ad-border bg-white">
        {/* One row: the label and the pane toggle. The department blurb used to sit
            between them, but by the time you're inside a department you already know
            what it is — it still introduces each one on the /staff picker, which is
            where choosing actually happens. flex-wrap so a narrow screen drops the
            toggle below the title instead of crushing it. */}
        <Container className="flex flex-wrap items-center justify-between gap-3 py-5">
          <h1 className="text-2xl font-semibold text-ad-ink sm:text-3xl">{dept.label}</h1>
          <DepartmentTabs department={department} />
        </Container>
      </div>

      <Container className="py-8">
        {/* Always default.tsx (null) — there is no page.tsx. The bare
            /staff/<department> is redirected to /tools by proxy.ts, deliberately:
            a redirect living in this slot gets retained across soft navigations
            and re-fires. See departmentIndexRedirect() in proxy.ts. */}
        {children}
        <DepartmentPanes department={department} tools={tools} training={training} />
      </Container>
    </>
  );
}
