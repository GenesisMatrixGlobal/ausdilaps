"use server";

// Staff management. Server actions are publicly reachable endpoints — the
// /admin layout guard does NOT protect them — so every one re-checks requireAdmin()
// for itself.
//
// All writes go through the service-role client, which bypasses RLS. That's
// deliberate and matches 0001's design note; there are no INSERT/UPDATE policies
// for authenticated users on profiles.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { normaliseDepartments, type DepartmentSlug } from "@/lib/departments";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const ASSIGNABLE_ROLES = ["staff", "admin", "superadmin"] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

function parseRole(value: unknown): AssignableRole | null {
  return ASSIGNABLE_ROLES.includes(value as AssignableRole) ? (value as AssignableRole) : null;
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

const NOT_CONFIGURED =
  "Supabase isn't configured on this deployment (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY). Staff management needs it.";

/** createAdminClient() throws when the service-role env is missing — surface that
 *  as a readable message instead of a blank 500. */
function adminClient(): { client: ReturnType<typeof createAdminClient> } | { error: string } {
  try {
    return { client: createAdminClient() };
  } catch {
    return { error: NOT_CONFIGURED };
  }
}

/** Invite a new staff member. Supabase sends the email; the 0005 trigger builds
 *  their profile from the metadata passed here. */
export async function inviteStaff(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = parseRole(formData.get("role"));
  const departments = normaliseDepartments(formData.getAll("departments").map(String));

  if (!email.includes("@")) return { ok: false, error: "Enter a valid email address." };
  if (!role) return { ok: false, error: "Pick a role." };
  if (role === "staff" && departments.length === 0) {
    return { ok: false, error: "Staff need at least one department, or they'll see nothing." };
  }

  const conn = adminClient();
  if ("error" in conn) return { ok: false, error: conn.error };

  const { error } = await conn.client.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl()}/staff/auth/callback?next=/staff`,
    data: {
      full_name: fullName || null,
      role,
      // Admins get every department implicitly, so don't store any for them.
      departments: role === "staff" ? departments : [],
      invited_by: admin.id,
    },
  });

  if (error) {
    if (/already been registered|already exists/i.test(error.message)) {
      return { ok: false, error: `${email} already has an account.` };
    }
    if (/rate limit|too many/i.test(error.message)) {
      return {
        ok: false,
        error:
          "Supabase's email rate limit was hit. Point Supabase → Auth → SMTP at Resend to lift it.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/staff");
  return { ok: true, message: `Invite sent to ${email}.` };
}

/** Change someone's role and/or departments. */
export async function updateStaff(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();

  const id = String(formData.get("id") ?? "");
  const role = parseRole(formData.get("role"));
  const departments = normaliseDepartments(formData.getAll("departments").map(String));

  if (!id) return { ok: false, error: "Missing user." };
  if (!role) return { ok: false, error: "Pick a role." };
  if (role === "staff" && departments.length === 0) {
    return { ok: false, error: "Staff need at least one department." };
  }

  // Lock-out guard: don't let an admin strip their own admin rights and leave
  // themselves unable to fix it.
  if (id === admin.id && role === "staff") {
    return { ok: false, error: "You can't remove your own admin access." };
  }
  if (role === "staff") {
    const guard = await ensureAnotherAdminExists(id);
    if (guard) return guard;
  }

  const conn = adminClient();
  if ("error" in conn) return { ok: false, error: conn.error };

  const { error } = await conn.client
    .from("profiles")
    .update({ role, departments: role === "staff" ? departments : [] })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/staff");
  return { ok: true, message: "Access updated." };
}

/** Deactivate or reactivate. Deactivating kills their access on the next request
 *  — getStaffUser() returns null for an inactive profile. */
export async function setStaffActive(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();

  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";

  if (!id) return { ok: false, error: "Missing user." };
  if (id === admin.id && !active) {
    return { ok: false, error: "You can't deactivate your own account." };
  }
  if (!active) {
    const guard = await ensureAnotherAdminExists(id);
    if (guard) return guard;
  }

  const conn = adminClient();
  if ("error" in conn) return { ok: false, error: conn.error };

  const { error } = await conn.client
    .from("profiles")
    .update({ is_active: active })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/staff");
  return { ok: true, message: active ? "Account reactivated." : "Account deactivated." };
}

/** Resend the invite/sign-in link. */
export async function resendInvite(formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email.includes("@")) return { ok: false, error: "Missing email." };

  const conn = adminClient();
  if ("error" in conn) return { ok: false, error: conn.error };
  const supabase = conn.client;

  const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl()}/staff/auth/callback?next=/staff`,
  });

  // Already-registered users can't be re-invited; send them a magic link instead.
  if (error && /already been registered|already exists/i.test(error.message)) {
    const { error: linkErr } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${siteUrl()}/staff/auth/callback?next=/staff`,
        shouldCreateUser: false,
      },
    });
    if (linkErr) return { ok: false, error: linkErr.message };
    return { ok: true, message: `Sign-in link sent to ${email}.` };
  }

  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Invite resent to ${email}.` };
}

/** Delete the auth user outright. The profile goes with it (ON DELETE CASCADE). */
export async function removeStaff(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing user." };
  if (id === admin.id) return { ok: false, error: "You can't remove your own account." };

  const guard = await ensureAnotherAdminExists(id);
  if (guard) return guard;

  const conn = adminClient();
  if ("error" in conn) return { ok: false, error: conn.error };

  const { error } = await conn.client.auth.admin.deleteUser(id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/staff");
  return { ok: true, message: "Staff member removed." };
}

/** Refuse the change if it would leave nobody able to administer the portal. */
async function ensureAnotherAdminExists(excludingId: string): Promise<ActionResult | null> {
  const conn = adminClient();
  if ("error" in conn) return { ok: false, error: conn.error };

  const { data, error } = await conn.client
    .from("profiles")
    .select("id")
    .in("role", ["admin", "superadmin"])
    .eq("is_active", true)
    .neq("id", excludingId);

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "That would leave no active admins. Promote someone else first." };
  }
  return null;
}

export type StaffRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  departments: DepartmentSlug[];
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
};

/** Everyone with a profile, newest first. Internal roles first so the staff list
 *  isn't buried under future client-portal users. */
export async function listStaff(): Promise<{ rows: StaffRow[]; error: string | null }> {
  await requireAdmin();

  const conn = adminClient();
  if ("error" in conn) return { rows: [], error: conn.error };

  const { data, error } = await conn.client
    .from("profiles")
    .select("id, email, full_name, role, departments, is_active, last_seen_at, created_at")
    .in("role", ["staff", "admin", "superadmin"])
    .order("created_at", { ascending: false });

  if (error) return { rows: [], error: error.message };

  return {
    rows: (data ?? []).map((r) => ({
      ...r,
      departments: normaliseDepartments(r.departments),
    })) as StaffRow[],
    error: null,
  };
}
