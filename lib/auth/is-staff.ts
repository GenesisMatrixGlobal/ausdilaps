import { getStaffUser } from "./session";

/**
 * Staff gate for the internal API routes the tools call.
 *
 * A real signed-in staff account is now the only way through in production
 * (see lib/auth/session.ts). The per-tool `*_ALLOW_UNAUTHED=true` env vars still
 * work for local dev, but are IGNORED in production — they used to short-circuit
 * this check first, which left the property-sizing, road-trace and site-markup
 * routes open to the internet on the live site.
 */
export async function isStaff(allowUnauthedEnvVar: string): Promise<boolean> {
  if (process.env.NODE_ENV !== "production" && process.env[allowUnauthedEnvVar] === "true") {
    return true;
  }

  return (await getStaffUser()) !== null;
}
