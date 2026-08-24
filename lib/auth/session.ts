// Staff auth — the whole surface for /staff and /admin.
//
// One Supabase user per staff member (magic link, invited from /admin/staff).
// Access is department-level: profiles.departments lists the departments a person
// can open. Company admins (role admin/superadmin) implicitly get every
// department plus /admin, so they never need boxes ticked.
//
// Server-only: uses next/headers.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  DEPARTMENT_SLUGS,
  normaliseDepartments,
  type DepartmentSlug,
} from "@/lib/departments";

export type StaffRole = "staff" | "admin" | "superadmin";

export type StaffUser = {
  id: string;
  email: string;
  fullName: string | null;
  role: StaffRole;
  /** Admins get every department; staff get exactly what's on their profile. */
  departments: DepartmentSlug[];
};

const STAFF_ROLES: StaffRole[] = ["staff", "admin", "superadmin"];

export function isAdmin(user: StaffUser): boolean {
  return user.role === "admin" || user.role === "superadmin";
}

export function canAccess(user: StaffUser, slug: DepartmentSlug): boolean {
  return isAdmin(user) || user.departments.includes(slug);
}

/**
 * The signed-in staff member, or null. Returns null — not a partial user — for
 * anyone who isn't active internal staff, so client-portal roles and
 * half-provisioned accounts can never reach a staff page.
 */
export async function getStaffUser(): Promise<StaffUser | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, full_name, email, departments, is_active")
      .eq("id", user.id)
      .single();

    if (!profile || profile.is_active === false) return null;
    if (!STAFF_ROLES.includes(profile.role as StaffRole)) return null;

    const role = profile.role as StaffRole;
    return {
      id: user.id,
      email: profile.email ?? user.email ?? "",
      fullName: profile.full_name ?? null,
      role,
      departments:
        role === "staff" ? normaliseDepartments(profile.departments) : [...DEPARTMENT_SLUGS],
    };
  } catch {
    // Supabase not configured, or network blip — fail closed.
    return null;
  }
}

/** Signed-in staff, or bounce to login preserving where they were headed. */
export async function requireStaff(next?: string): Promise<StaffUser> {
  const user = await getStaffUser();
  if (!user) redirect(loginUrl(next));
  return user;
}

/** Staff with access to this department, or 403. */
export async function requireDepartment(slug: DepartmentSlug, next?: string): Promise<StaffUser> {
  const user = await requireStaff(next);
  if (!canAccess(user, slug)) forbidden();
  return user;
}

/** Company admins only. */
export async function requireAdmin(next?: string): Promise<StaffUser> {
  const user = await requireStaff(next);
  if (!isAdmin(user)) forbidden();
  return user;
}

export function loginUrl(next?: string): string {
  return next ? `/staff/login?next=${encodeURIComponent(next)}` : "/staff/login";
}

/** Renders app/staff/forbidden — a real page, not a redirect loop. */
function forbidden(): never {
  redirect("/staff/no-access");
}
