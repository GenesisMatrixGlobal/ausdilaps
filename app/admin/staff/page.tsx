import { requireAdmin } from "@/lib/auth/session";
import { DEPARTMENTS } from "@/lib/departments";
import { listStaff } from "./actions";
import { InviteStaff } from "./invite-staff";
import { StaffTable } from "./staff-table";

export default async function AdminStaffPage() {
  const admin = await requireAdmin("/admin/staff");
  const { rows, error } = await listStaff();

  // Never signed in, and not deactivated — someone is waiting on a link that may have expired.
  const pending = rows.filter((r) => r.is_active && !r.last_sign_in_at);

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

      {pending.length > 0 && (
        <div className="mt-6 rounded-lg border border-ad-border border-l-[3px] border-l-ad-orange bg-ad-orange/5 p-3.5">
          <p className="text-sm font-semibold text-ad-ink">
            {pending.length} pending {pending.length === 1 ? "invite" : "invites"}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-ad-muted">
            Waiting on {pending.map((r) => r.full_name || r.email).join(", ")}. Invite links are short-lived, so if
            it&rsquo;s been more than a day or two, use{" "}
            <span className="font-medium text-ad-ink">Resend link</span> rather than waiting any longer.
          </p>
        </div>
      )}

      <div className="mt-8">
        <StaffTable rows={rows} departments={DEPARTMENTS} currentUserId={admin.id} />
      </div>
    </div>
  );
}
