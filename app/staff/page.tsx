import { DEPARTMENTS } from "@/lib/departments";
import { requireStaff, canAccess, isAdmin } from "@/lib/auth/session";
import { toolsForDepartment } from "@/lib/tools/registry";
import { getTrainingModules } from "@/lib/training";
import { Container } from "@/components/marketing/container";
import { CardGrid, LinkCard } from "@/components/staff/card-grid";
import { EmptyState } from "@/components/staff/empty-state";

export default async function StaffHomePage() {
  const user = await requireStaff("/staff");
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
          <CardGrid>
            {departments.map((d) => {
              const tools = toolsForDepartment(d.slug).length;
              const modules = getTrainingModules(d.slug).length;
              const counts = [
                `${tools} ${tools === 1 ? "tool" : "tools"}`,
                `${modules} ${modules === 1 ? "module" : "modules"}`,
              ].join(" · ");

              return (
                <LinkCard
                  key={d.slug}
                  href={`/staff/${d.slug}`}
                  title={d.label}
                  description={d.blurb}
                  meta={counts}
                />
              );
            })}
          </CardGrid>
        )}
      </div>
    </Container>
  );
}
