// The access gate on /dilapidation-reports/samples.
//
// ⚠️ THE WAY IN IS NAME + EMAIL, and since 2026-09-30 it is the ONLY one on screen (Rhys).
// The code box beside it was a second door that halved the thing the gate exists for: every
// person who used it arrived anonymously, and /admin/samples could only ever show them as
// "Visitor 3f9a2c1e · Access code". Lead capture was always the point; a courtesy filter
// against bulk download is the side effect.
//
// `?code=` IS STILL HONOURED and deliberately so — quote links already sent carry it, and
// dumping those clients at a form to re-type details we hold would be a worse experience
// than the anonymity costs us. Nothing on the page advertises it; it simply works. Clear
// `SAMPLES_ACCESS_CODE` once the quotes carrying it have aged out and that door closes.
//
// Runs in proxy.ts (edge/middleware) AND in a route handler, so this file uses only
// WebCrypto and process.env — no Node-only imports.

/** Cookie that marks a browser as unlocked. httpOnly, so the page never reads it — the
 *  middleware does, and rewrites to the library route. */
export const SAMPLES_COOKIE = "ad_samples";

/** Six months. Long on purpose: a client who checked samples in March should not have to
 *  dig out the quote email again in August. */
export const SAMPLES_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

export const SAMPLES_PATH = "/dilapidation-reports/samples";
/** The real list. Only ever reached by rewrite from SAMPLES_PATH; a direct hit without
 *  the cookie is redirected back. Not in the sitemap, noindex. */
export const SAMPLES_LIBRARY_PATH = "/dilapidation-reports/samples/library";

/** LEGACY. Comma-separated, and now only for quote links already in the wild — nothing on
 *  the page offers a code any more. Unset is the end state and closes that door; the gate
 *  itself is unconditional, so unsetting it can no longer open the library to everyone.
 *  ⚠️ There is deliberately NO `gateEnabled()` any more: it returned false when this was
 *  unset, which would now mean "no code configured, so let the world in". */
export function accessCodes(): string[] {
  return (process.env.SAMPLES_ACCESS_CODE ?? "")
    .split(",")
    .map(normaliseCode)
    .filter(Boolean);
}

/** Codes are case- and whitespace-insensitive, and dashes are optional — a client
 *  reading "AD-1234" off a printed quote types whatever they like. */
export function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, "");
}

/** What the cookie holds: a hash of the code, not the code. A forged cookie needs the
 *  code itself, which is the same trust level as the gate, and a leaked cookie does not
 *  reveal the code to anyone reading the jar. */
export async function cookieValueFor(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`ausdilaps-samples:${normaliseCode(code)}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function isValidCode(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const code = normaliseCode(raw);
  return accessCodes().includes(code);
}

/** An email unlock, or any still-configured code. Both are checked so a browser let in by a
 *  legacy quote link keeps its six months even after the code is retired. */
export async function isValidCookie(value: string | null | undefined): Promise<boolean> {
  if (!value) return false;
  if (value === (await unlockCookieValue())) return true;
  for (const code of accessCodes()) {
    if ((await cookieValueFor(code)) === value) return true;
  }
  return false;
}

/**
 * What an EMAIL unlock writes. A fixed token, NOT a hash of some code — it has to work when
 * `SAMPLES_ACCESS_CODE` is unset, which is the end state.
 *
 * It is the same value for everyone, so someone could read their own cookie and pass it on.
 * That is the trust level this gate has always had: one code went on every quote, so it was
 * equally shareable. This is a courtesy filter and a lead form, never a secret — see the
 * header. Returns a string rather than `string | null`, so the caller can no longer end up
 * setting nothing and silently leaving the visitor outside.
 */
export async function unlockCookieValue(): Promise<string> {
  return cookieValueFor("email-unlock");
}

/**
 * A random id for the BROWSER, so /admin/samples can read one visitor's views and clicks as
 * one history (migration 0021). Set on the first hit to the samples page, before any
 * unlock, so the locked-page views and the eventual unlock join up. Same options as the
 * access cookie — httpOnly, six months, scoped to /dilapidation-reports, which is also
 * where the click route lives so the beacon carries both cookies.
 *
 * It says nothing about who the person is. A name only ever attaches through the email
 * unlock (lead_id); the code is shared across every quote, so a code unlock stays anonymous.
 */
export const SAMPLES_VISITOR_COOKIE = "ad_samples_v";

/** Where the library posts "this file was opened". Under the samples path on purpose: the
 *  cookies above are scoped to /dilapidation-reports and would not reach /api/*. */
export const SAMPLES_CLICK_PATH = "/dilapidation-reports/samples/click";

/** Where the page confirms it was actually PAINTED (migration 0024). Under the samples path
 *  for the same reason as the click beacon: the visitor cookie is scoped to
 *  /dilapidation-reports and would never be sent to /api/*. */
export const SAMPLES_RENDERED_PATH = "/dilapidation-reports/samples/rendered";

export function newVisitorId(): string {
  return crypto.randomUUID();
}

/** A cookie value is untrusted input; only a UUID-shaped one is ever written to a row. */
export function isVisitorId(value: string | null | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export const SAMPLES_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/dilapidation-reports",
  maxAge: SAMPLES_COOKIE_MAX_AGE,
};
