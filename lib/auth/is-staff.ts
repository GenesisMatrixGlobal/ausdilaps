import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_SESSION_COOKIE, expectedAdminSessionToken } from "./admin-session";

/**
 * Staff gate shared by internal admin API routes. Real per-user auth (login UI)
 * lands with the Phase-6 admin backend; until then, the whole /admin section sits
 * behind one shared team password (see admin-session.ts + middleware.ts) — passing
 * that gate is enough to use any tool. Each tool also keeps its own
 * `*_ALLOW_UNAUTHED=true` env escape hatch for local dev. When a Supabase session
 * exists, only internal staff (admin/superadmin) pass.
 */
export async function isStaff(allowUnauthedEnvVar: string): Promise<boolean> {
  if (process.env[allowUnauthedEnvVar] === "true") return true;

  const expected = await expectedAdminSessionToken();
  if (expected) {
    const store = await cookies();
    if (store.get(ADMIN_SESSION_COOKIE)?.value === expected) return true;
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    return profile?.role === "admin" || profile?.role === "superadmin";
  } catch {
    return false;
  }
}
