import { getStaffUser } from "@/lib/auth/session";
import { StaffHeader } from "@/components/staff/staff-header";

export const metadata = {
  title: "Staff portal · AusDilaps",
  robots: { index: false, follow: false },
};

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  // Not requireStaff() — /staff/login and /staff/no-access live under this
  // layout and must render without a session. proxy.ts does the gating; each
  // page below calls requireStaff/requireDepartment for itself.
  const user = await getStaffUser();

  return (
    <div className="min-h-screen bg-white">
      {user && <StaffHeader user={user} />}
      {children}
    </div>
  );
}
