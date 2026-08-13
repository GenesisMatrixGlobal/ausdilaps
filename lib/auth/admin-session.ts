// Super-basic shared-password gate for /admin — one team password
// (ADMIN_ACCESS_PASSWORD) unlocks the whole staff tools section. No per-user
// accounts yet; real Supabase-backed staff auth is still the eventual Phase-6
// plan (see isStaff() in ./is-staff.ts) — this just keeps the live site from
// being wide open in the meantime.
//
// Uses Web Crypto (`crypto.subtle`) rather than Node's `crypto` module so the
// same code runs in both the Edge middleware and Node API routes.

export const ADMIN_SESSION_COOKIE = "ad_admin_session";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The cookie never carries the plaintext password — just a hash of it, so the
 *  password itself never sits in the browser. Null if ADMIN_ACCESS_PASSWORD isn't set. */
export async function expectedAdminSessionToken(): Promise<string | null> {
  const password = process.env.ADMIN_ACCESS_PASSWORD;
  if (!password) return null;
  return sha256Hex(`ausdilaps-admin-session:${password}`);
}

export function verifyAdminPassword(candidate: string): boolean {
  const password = process.env.ADMIN_ACCESS_PASSWORD;
  return !!password && candidate === password;
}
