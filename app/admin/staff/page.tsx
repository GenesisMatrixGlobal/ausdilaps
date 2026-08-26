import { requireAdmin } from "@/lib/auth/session";
import { DEPARTMENTS } from "@/lib/departments";
import { listStaff } from "./actions";
import { InviteStaff } from "./invite-staff";
import { StaffTable } from "./staff-table";

export default async function AdminStaffPage() {
  const admin = await requireAdmin("/admin/staff");
  const { rows, error } = await listStaff();

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ad-ink">Staff</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ad-muted">
            Invite staff and choose which departments they can open. Company admins see every
            department automatically.
          </p>
        </div>
        <InviteStaff departments={DEPARTMENTS} />
      </div>

      {error && (
        <p className="mt-6 rounded-lg border border-ad-orange/30 bg-ad-orange/5 px-3 py-2 text-sm text-ad-ink">
          Couldn&rsquo;t load staff: {error}
        </p>
      )}

      <div className="mt-8">
        <StaffTable rows={rows} departments={DEPARTMENTS} currentUserId={admin.id} />
      </div>
    </div>
  );
}
