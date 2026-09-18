import { requireAdmin } from "@/lib/auth/session";
import { DEPARTMENTS } from "@/lib/departments";
import { getTool } from "@/lib/tools/registry";
import { loadToolUsageByUser } from "@/lib/tools/usage";
import { listStaff } from "./actions";
import { InviteStaff } from "./invite-staff";
import { StaffTable, type StaffUsage } from "./staff-table";

export default async function AdminStaffPage() {
  const admin = await requireAdmin("/admin/staff");
  const [{ rows, error }, usageByUser] = await Promise.all([listStaff(), loadToolUsageByUser()]);

  // A Map does not cross the server→client boundary, and the client has no registry to turn
  // a slug into a title — so both are resolved here and handed over as plain data.
  const usage: Record<string, StaffUsage> = {};
  for (const [userId, stat] of usageByUser) {
    usage[userId] = {
      last30Days: stat.last30Days,
      lastUsedAt: stat.lastUsedAt,
      byTool: stat.byTool.map((t) => ({
        title: getTool(t.toolSlug)?.title ?? t.toolSlug,
        count: t.count,
      })),
    };
  }

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
        <StaffTable rows={rows} departments={DEPARTMENTS} currentUserId={admin.id} usage={usage} />
      </div>

      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ad-muted">
        &ldquo;Last active&rdquo; is the last time they opened any staff page, to the nearest 15 minutes.
        Tool uses count the last 30 days and exclude games. Uses recorded before per-person tracking
        was switched on aren&rsquo;t attributed to anyone.
      </p>
    </div>
  );
}
