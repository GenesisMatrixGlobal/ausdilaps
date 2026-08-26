import { after } from "next/server";
import { canAccess, getStaffUser, isAdmin } from "./session";
import { recordToolUse } from "@/lib/tools/usage";
import type { DepartmentSlug } from "@/lib/departments";

/**
 * Staff gate for the internal API routes the tools call.
 *
 * A real signed-in staff account is now the only way through in production
 * (see lib/auth/session.ts). The per-tool `*_ALLOW_UNAUTHED=true` env vars still
 * work for local dev, but are IGNORED in production — they used to short-circuit
 * this check first, which left the property-sizing, road-trace and site-markup
 * routes open to the internet on the live site.
 *
 * `toolSlug` is optional and only drives the usage counter on /admin/tools. It is passed
 * explicitly rather than derived from `allowUnauthedEnvVar`, because those env vars are
 * NOT one-to-one with tools: KML_ROAD_TRACE_ALLOW_UNAUTHED covers four routes, and
 * KML_STANDARD_MARKUP_ALLOW_UNAUTHED is reused by both places/* routes. Deriving it would
 * produce numbers that look right and aren't.
 */
export async function isStaff(
  allowUnauthedEnvVar: string,
  toolSlug?: string
): Promise<boolean> {
  const devBypass =
    process.env.NODE_ENV !== "production" && process.env[allowUnauthedEnvVar] === "true";
  const allowed = devBypass || (await getStaffUser()) !== null;

  // Count the use, never block on it. after() runs post-response but keeps the function
  // alive until it settles — a bare floating promise can be killed when the response ends.
  if (allowed && toolSlug) {
    after(() => recordToolUse(toolSlug));
  }

  return allowed;
}

/**
 * Department-scoped variant of the gate above.
 *
 * isStaff() lets any signed-in staff member call any tool's API — fine for the estimating
 * utilities, wrong for commercially sensitive data like the tender pipeline. Callers pass
 * the department list from the tool's own config module (e.g. TENDER_WATCH_DEPARTMENTS)
 * so the API and the tool registry can never disagree about who has access.
 *
 * Admins and superadmins pass for every department, matching canAccess() and the
 * public.has_department() helper the RLS policies use.
 */
export async function isStaffInAnyDepartment(
  slugs: readonly DepartmentSlug[],
  allowUnauthedEnvVar: string
): Promise<boolean> {
  if (process.env.NODE_ENV !== "production" && process.env[allowUnauthedEnvVar] === "true") {
    return true;
  }

  const user = await getStaffUser();
  return !!user && slugs.some((slug) => canAccess(user, slug));
}

/**
 * Company-admin gate for API routes.
 *
 * requireAdmin() redirects, which is right for a page and wrong for a JSON endpoint, so
 * this returns a boolean instead. proxy.ts does not match /api/*, so this is the only
 * thing standing in front of these routes.
 */
export async function isApiAdmin(): Promise<boolean> {
  const user = await getStaffUser();
  return !!user && isAdmin(user);
}
