/**
 * The one rule for a `?next=` redirect after sign-in: it must be a path on THIS site.
 *
 * `startsWith("/")` is not that rule. `//evil.com/x` and `/\evil.com` both start with a
 * slash, and `new URL(next, origin)` resolves both OFF-site — so a phishing link to the
 * real login page could hand a freshly signed-in staff member to a lookalike domain
 * (found in the 2026-09-10 security sweep). Resolving against a fixed sentinel origin and
 * checking it stayed there catches every spelling of that trick, including ones the
 * regex author has not thought of.
 *
 * Pure and dependency-free so the login form (a client component) can share it.
 */
const FALLBACK = "/staff";
const SENTINEL = "https://ausdilaps.invalid";

export function safeNext(next: string | null | undefined): string {
  if (!next) return FALLBACK;
  // One leading slash, not followed by another slash or a backslash.
  if (!/^\/(?![/\\])/.test(next)) return FALLBACK;
  let url: URL;
  try {
    url = new URL(next, SENTINEL);
  } catch {
    return FALLBACK;
  }
  if (url.origin !== SENTINEL) return FALLBACK;
  const path = url.pathname + url.search;
  // Never back onto a login route — that would loop.
  if (path.startsWith("/staff/login") || path.startsWith("/admin/login")) return FALLBACK;
  return path;
}
