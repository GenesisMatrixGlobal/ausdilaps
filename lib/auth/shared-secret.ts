import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Bearer-secret gate for entry points that no cookie session can reach — the nightly
 * cron and the health check.
 *
 * These are the repo's first such endpoints, so this sets the precedent. Two rules, both
 * learned from the *_ALLOW_UNAUTHED incident recorded in lib/auth/is-staff.ts (those env
 * vars used to short-circuit the auth check, which left tool routes open on the live
 * site):
 *
 *   1. A missing secret FAILS CLOSED. This is deliberately not the Turnstile pattern in
 *      app/api/quote/route.ts, where an absent secret skips the check — correct for a
 *      public form with a honeypot, catastrophic for an endpoint that spends money on the
 *      Anthropic API and emails staff.
 *   2. A too-short secret fails closed too, so CRON_SECRET=test can never be live.
 */

const MIN_SECRET_LENGTH = 32;

/**
 * Constant-time compare that is safe for unequal lengths.
 *
 * timingSafeEqual throws on a length mismatch, and the naive fix — comparing lengths
 * first — leaks the length. Hashing both sides makes the buffers always 32 bytes, so the
 * comparison is both safe and constant-time regardless of input.
 */
export function secretMatches(presented: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(presented, "utf8").digest(),
    createHash("sha256").update(expected, "utf8").digest()
  );
}

export type SecretGate =
  | { ok: true }
  | { ok: false; status: 401 | 503; reason: string };

/** Warn once per cold start rather than per request — serverless has no startup hook. */
let warnedMissing = false;

/**
 * Checks `Authorization: Bearer <secret>` against an env var.
 *
 * Vercel Cron sends exactly this header automatically once CRON_SECRET is set on the
 * project. Returns 503 (not 401) when the secret is unconfigured, so a deployment gap is
 * distinguishable from a rejected caller in the logs.
 */
export function requireBearerSecret(req: Request, envVar: string): SecretGate {
  const expected = process.env[envVar];

  if (!expected) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.error(`[tenders] ${envVar} is not set — refusing to run. This endpoint fails closed.`);
    }
    return { ok: false, status: 503, reason: "This endpoint is not configured." };
  }

  if (expected.length < MIN_SECRET_LENGTH) {
    console.error(`[tenders] ${envVar} is shorter than ${MIN_SECRET_LENGTH} characters — refusing to run.`);
    return { ok: false, status: 503, reason: "This endpoint is not configured correctly." };
  }

  const header = req.headers.get("authorization") ?? "";
  const presented = header.replace(/^bearer\s+/i, "").trim();
  if (!presented || !secretMatches(presented, expected)) {
    return { ok: false, status: 401, reason: "Not authorised." };
  }

  return { ok: true };
}
