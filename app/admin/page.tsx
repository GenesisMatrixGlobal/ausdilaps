import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { DEPARTMENTS } from "@/lib/departments";
import { TOOLS } from "@/lib/tools/registry";
import { listStaff } from "./staff/actions";
import { CardGrid, LinkCard } from "@/components/staff/card-grid";
import { StatTiles } from "@/components/staff/stat-tiles";

export default async function AdminHomePage() {
  await requireAdmin("/admin");
  const { rows } = await listStaff();

  const active = rows.filter((r) => r.is_active).length;
  const admins = rows.filter(
    (r) => r.is_active && (r.role === "admin" || r.role === "superadmin")
  ).length;

  const stats = [
    { label: "Active staff", value: active },
    { label: "Company admins", value: admins },
    { label: "Departments", value: DEPARTMENTS.length },
    { label: "Tools", value: TOOLS.length },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ad-ink">Admin</h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ad-muted">
        Staff access and the tool registry. Everything staff actually use lives in the{" "}
        <Link href="/staff" className="font-medium text-ad-steel hover:underline">
          staff portal
        </Link>
        .
      </p>

      <div className="mt-8">
        <StatTiles stats={stats} />
      </div>

      <div className="mt-8">
        <CardGrid>
          <LinkCard
            href="/admin/staff"
            title="Staff"
            description="Invite staff, assign departments, deactivate people who've left."
          />
          <LinkCard
            href="/admin/tools"
            title="Tools"
            description="Which tools exist and which departments each one appears under."
          />
          <LinkCard
            href="/admin/tender-watch"
            title="Tender Watch"
            description="Nightly tender scan — pipeline health, source status and the classified queue."
          />
        </CardGrid>
      </div>
    </div>
  );
}
