import { redirect } from "next/navigation";
import { DEPARTMENTS } from "@/lib/departments";
import { requireStaff, canAccess, isAdmin } from "@/lib/auth/session";
import { toolsForDepartment } from "@/lib/tools/registry";
import { getTrainingModules } from "@/lib/training";
import { Container } from "@/components/marketing/container";
import { RowList, LinkRow } from "@/components/staff/row-list";
import { EmptyState } from "@/components/staff/empty-state";

export default async function StaffHomePage() {
  const user = await requireStaff("/staff");

  // Someone who only belongs to one department has nothing to pick — send them
  // straight there. Admins implicitly hold every department, so they'd never
  // qualify anyway; they keep the list because overseeing all five is the job.
  if (!isAdmin(user) && user.departments.length === 1) {
    redirect(`/staff/${user.departments[0]}`);
  }

  const departments = DEPARTMENTS.filter((d) => canAccess(user, d.slug));
  const firstName = user.fullName?.split(" ")[0];

  return (
    <Container className="py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ad-steel">
        AusDilaps Staff Portal
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-ad-ink sm:text-3xl">
        {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ad-muted">
        {isAdmin(user)
          ? "You're a company admin, so you can see every department. Manage staff access in Admin."
          : "Pick a department to get to its tools and training."}
      </p>

      <div className="mt-8">
        {departments.length === 0 ? (
          <EmptyState
            title="No departments assigned yet"
            body="Your account is active but no departments have been added to it. Ask a company admin to assign your access."
          />
        ) : (
          <RowList>
            {departments.map((d) => {
              const tools = toolsForDepartment(d.slug).length;
              const modules = getTrainingModules(d.slug).length;
              const counts = [
                `${tools} ${tools === 1 ? "tool" : "tools"}`,
                `${modules} ${modules === 1 ? "module" : "modules"}`,
              ].join(" · ");

              return (
                <LinkRow
                  key={d.slug}
                  href={`/staff/${d.slug}`}
                  title={d.label}
                  description={d.blurb}
                  meta={counts}
                />
              );
            })}
          </RowList>
        )}
      </div>
    </Container>
  );
}
