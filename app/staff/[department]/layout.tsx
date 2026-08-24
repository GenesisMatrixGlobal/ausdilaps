import { notFound } from "next/navigation";
import { getDepartment, isDepartmentSlug } from "@/lib/departments";
import { requireDepartment } from "@/lib/auth/session";
import { Container } from "@/components/marketing/container";
import { DepartmentTabs } from "@/components/staff/department-tabs";

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

export default async function DepartmentLayout({
  params,
  children,
}: {
  params: Promise<{ department: string }>;
  children: React.ReactNode;
}) {
  const { department } = await params;
  if (!isDepartmentSlug(department)) notFound();

  // Redirects to /staff/no-access if this person's departments don't include it.
  await requireDepartment(department, `/staff/${department}`);
  const dept = getDepartment(department)!;

  return (
    <>
      <div className="border-b border-ad-border bg-white">
        <Container className="py-7">
          <h1 className="text-2xl font-semibold text-ad-ink sm:text-3xl">{dept.label}</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ad-muted">{dept.blurb}</p>
          <div className="mt-5">
            <DepartmentTabs department={department} />
          </div>
        </Container>
      </div>

      <Container className="py-8">{children}</Container>
    </>
  );
}
