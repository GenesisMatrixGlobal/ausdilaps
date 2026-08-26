// Staff auth — the whole surface for /staff and /admin.
//
// One Supabase user per staff member (magic link, invited from /admin/staff).
// Access is department-level: profiles.departments lists the departments a person
// can open. Company admins (role admin/superadmin) implicitly get every
// department plus /admin, so they never need boxes ticked.
//
// Server-only: uses next/headers.

import { cache } from "react";
import { after } from "next/server";
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
  /**
   * May add and edit knowledge-base content for their own departments.
   *
   * Separate from role on purpose: curating a department's training material is a job a
   * department lead does, not a reason to hand someone the admin panel. Admins bypass the
   * flag entirely.
   */
  canManageKnowledge: boolean;
};

const STAFF_ROLES: StaffRole[] = ["staff", "admin", "superadmin"];

export function isAdmin(user: StaffUser): boolean {
  return user.role === "admin" || user.role === "superadmin";
}

export function canAccess(user: StaffUser, slug: DepartmentSlug): boolean {
  return isAdmin(user) || user.departments.includes(slug);
}

/**
 * May this person publish content tagged to exactly these departments?
 *
 * Mirrors public.can_edit_knowledge() in migration 0009 — keep the two in step.
 *
 * "Every", not "some": if belonging to one listed department were enough, an estimator
 * could publish into Inspectors simply by tagging their own team alongside. An empty list
 * means company-wide, which is admins only.
 */
export function canEditKnowledge(user: StaffUser, departments: DepartmentSlug[]): boolean {
  if (isAdmin(user)) return true;
  if (!user.canManageKnowledge) return false;
  return departments.length > 0 && departments.every((d) => user.departments.includes(d));
}

/**
 * The signed-in staff member, or null. Returns null — not a partial user — for
 * anyone who isn't active internal staff, so client-portal roles and
 * half-provisioned accounts can never reach a staff page.
 */
/**
 * Local-only sign-in bypass, for walking the portal without a magic link.
 *
 * HARD-GATED ON NODE_ENV. Vercel sets NODE_ENV=production on every deployment including
 * previews, so this branch cannot run anywhere but a dev machine — even if the env var
 * were set in Vercel by accident.
 *
 * Logged loudly on every use, because the failure mode for a thing like this is forgetting
 * it is on and then wondering why an auth bug won't reproduce.
 */
function previewUser(): StaffUser | null {
  if (process.env.NODE_ENV === "production" || process.env.STAFF_PREVIEW !== "1") return null;
  console.warn("[auth] STAFF_PREVIEW=1 — sign-in bypassed. Local only; never applies to a deployment.");
  return {
    id: "00000000-0000-0000-0000-000000000000",
    email: "preview@ausdilaps.com.au",
    fullName: "Preview (local)",
    role: "superadmin",
    departments: [...DEPARTMENT_SLUGS],
    canManageKnowledge: true,
  };
}

async function loadStaffUser(): Promise<StaffUser | null> {
  const preview = previewUser();
  if (preview) return preview;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const COLUMNS = "role, full_name, email, departments, is_active, last_seen_at";

    // can_manage_knowledge arrives with migration 0009. Selecting a column that doesn't
    // exist yet is an error, not a null — and an error here logs EVERY staff member out,
    // because this function fails closed. Migrations are applied by hand in this project,
    // so a deploy landing before its migration is a real possibility; falling back costs
    // one extra round trip in that window and nothing at all afterwards.
    let profile: Record<string, unknown> | null = null;
    const withFlag = await supabase
      .from("profiles")
      .select(`${COLUMNS}, can_manage_knowledge`)
      .eq("id", user.id)
      .single();

    if (withFlag.error && /can_manage_knowledge/.test(withFlag.error.message)) {
      console.warn("[auth] profiles.can_manage_knowledge missing — apply migration 0009.");
      const { data } = await supabase
        .from("profiles")
        .select(COLUMNS)
        .eq("id", user.id)
        .single();
      profile = data as Record<string, unknown> | null;
    } else {
      profile = withFlag.data as Record<string, unknown> | null;
    }

    if (!profile || profile.is_active === false) return null;
    if (!STAFF_ROLES.includes(profile.role as StaffRole)) return null;

    touchLastSeen(user.id, profile.last_seen_at as string | null);

    const role = profile.role as StaffRole;
    return {
      id: user.id,
      email: (profile.email as string | null) ?? user.email ?? "",
      fullName: (profile.full_name as string | null) ?? null,
      role,
      departments:
        role === "staff" ? normaliseDepartments(profile.departments) : [...DEPARTMENT_SLUGS],
      canManageKnowledge: profile.can_manage_knowledge === true,
    };
  } catch {
    // Supabase not configured, or network blip — fail closed.
    return null;
  }
}

/** Don't write more often than this per person. */
const LAST_SEEN_INTERVAL_MS = 15 * 60_000;

/**
 * Records that this person is active, for the "who is actually using the portal" panel
 * on /admin.
 *
 * Two things this must not do, both learned the hard way:
 *
 *   1. Slow the request down. It runs inside after(), so it happens post-response — the
 *      user never waits on it, and Vercel keeps the function alive until it settles.
 *   2. Write on every request. Without the interval check this would add a round trip to
 *      Sydney to every single page load, undoing the work that took /admin from ~1s to
 *      ~180ms. Fifteen minutes is plenty of resolution for "signed in this week".
 *
 * Uses the SERVICE-ROLE client on purpose: profiles has no update policy for ordinary
 * users. 0005 dropped "profiles self update" because it had a USING clause with no WITH
 * CHECK, which let anyone change their own role. That stays dropped.
 */
function touchLastSeen(userId: string, lastSeenAt: string | null): void {
  const due =
    !lastSeenAt || Date.now() - new Date(lastSeenAt).getTime() > LAST_SEEN_INTERVAL_MS;
  if (!due) return;

  after(async () => {
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      await createAdminClient()
        .from("profiles")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", userId);
    } catch (e) {
      // Never let presence tracking break a page load.
      console.error("[auth] last_seen_at update failed:", (e as Error).message);
    }
  });
}

/**
 * Memoised for the lifetime of ONE request.
 *
 * Each call costs two round trips to Supabase (verify the JWT, then read the
 * profile), and Supabase is in Tokyo — roughly 100ms each from Sydney. Without
 * this, a single /admin render paid for that repeatedly: the layout calls
 * requireAdmin(), the page calls it again, and listStaff() calls it a third time.
 * Eight sequential Tokyo round trips for one page, which measured ~1s.
 *
 * React's cache() is scoped to a single request, so this changes nothing about
 * security: every incoming request still verifies from scratch, and server
 * actions — which are separate requests — still re-check for themselves, which is
 * what the note at the top of app/admin/staff/actions.ts requires.
 */
export const getStaffUser = cache(loadStaffUser);

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

/** Staff who may curate this department's knowledge base, or 403. */
export async function requireKnowledgeEditor(
  slug: DepartmentSlug,
  next?: string
): Promise<StaffUser> {
  const user = await requireStaff(next);
  if (!canEditKnowledge(user, [slug])) forbidden();
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
