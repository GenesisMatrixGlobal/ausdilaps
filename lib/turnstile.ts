// The Turnstile check, shared by /api/quote and /api/quote/uploads.

/** Once per cold start, not per request. */
let warnedUnprotected = false;

/**
 * - "ok": verified, or Turnstile isn't configured at all (the form then runs on the
 *   honeypot alone and says so once per cold start — taking the enquiry form down over a
 *   missing env var is worse than spam).
 * - "failed": the token was rejected.
 * - "unconfigured": the widget is on the form (site key set) but the secret is missing.
 *   FAILS CLOSED rather than quietly waving every submission through, which is what the
 *   2026-09-10 sweep found production doing.
 */
export async function checkTurnstile(
  token: string,
  ip: string | null
): Promise<"ok" | "failed" | "unconfigured"> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
      console.error("[turnstile] NEXT_PUBLIC_TURNSTILE_SITE_KEY is set but TURNSTILE_SECRET_KEY is not — refusing.");
      return "unconfigured";
    }
    if (!warnedUnprotected) {
      warnedUnprotected = true;
      console.warn("[turnstile] not configured — the enquiry form is running on the honeypot alone.");
    }
    return "ok";
  }
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success ? "ok" : "failed";
  } catch {
    return "failed";
  }
}
