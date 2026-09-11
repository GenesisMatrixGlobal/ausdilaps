// The access gate on /dilapidation-reports/samples.
//
// A courtesy filter, not a secret: the code goes on every quote and in every email as a
// link (`/samples?code=XXXX`), so a client never types it. Its job is to stop lazy
// crawling and bulk download of the sample library, and to turn cold visitors into a
// name + email. A competitor can request a quote and get in — that is fine, they are
// then a lead.
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

/** Comma-separated so two codes can overlap during a rotation — the quotes already in
 *  the wild keep working while new ones carry the new code. */
export function accessCodes(): string[] {
  return (process.env.SAMPLES_ACCESS_CODE ?? "")
    .split(",")
    .map(normaliseCode)
    .filter(Boolean);
}

/** No codes configured = no gate. Fail OPEN: an unset variable on a marketing page should
 *  never hide the library from the clients it exists for. */
export function gateEnabled(): boolean {
  return accessCodes().length > 0;
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

export async function isValidCookie(value: string | null | undefined): Promise<boolean> {
  if (!value) return false;
  for (const code of accessCodes()) {
    if ((await cookieValueFor(code)) === value) return true;
  }
  return false;
}

/** Cookie value for a browser unlocked by the EMAIL path — hashed against the first
 *  configured code, so it validates exactly like a code unlock and expires with it. */
export async function unlockCookieValue(): Promise<string | null> {
  const [first] = accessCodes();
  return first ? cookieValueFor(first) : null;
}

export const SAMPLES_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/dilapidation-reports",
  maxAge: SAMPLES_COOKIE_MAX_AGE,
};
