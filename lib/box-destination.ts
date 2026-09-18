/**
 * Guards shared by every route that files a browser-supplied image into Box.
 *
 * Three upload routes (site markup, cover photo, closeout markup) take a base64 image, a
 * filename and a destination from the browser and write them with the Box service
 * account, which has enterprise-wide write. The 2026-09-10 security sweep found that
 * any signed-in staff member could therefore upload ANY bytes under ANY name into ANY
 * folder id — an `Invoice.html` into the Accounts tree, say — and link it onto a Quote.
 *
 *   - isPng()             the bytes must be what the route says they are.
 *   - asPngName()         the name must end in .png, whatever was typed.
 *   - signDestination()   the folder the operator CONFIRMED on the resolve step is the
 *                         only folder the upload step will accept. The resolve route
 *                         signs {kind, recordId, folderId}; the upload route verifies it.
 *                         Stateless, so two Vercel invocations need no shared store.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { splitExtension } from "@/lib/box";

/** 15- or 18-character Salesforce record id. */
export const SF_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

const PNG_MAGIC = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_MAGIC.length) return false;
  for (let i = 0; i < PNG_MAGIC.length; i++) if (bytes[i] !== PNG_MAGIC[i]) return false;
  return true;
}

/** Whatever extension was typed, the file is a PNG and is named as one. */
export function asPngName(filename: string, fallbackStem = "Markup"): string {
  const { stem } = splitExtension(filename);
  return `${stem.trim() || fallbackStem}.png`;
}

/** A sidecar is a save file; it is always .json and always application/json. */
export function asJsonName(filename: string, fallbackStem = "Markup"): string {
  const { stem } = splitExtension(filename);
  return `${stem.trim() || fallbackStem}.json`;
}

export type Destination = {
  /** Which sync — the token from one route must not open another. */
  kind: "site-markup" | "cover-photo";
  /** The Salesforce record the operator resolved (Quote or Survey id). */
  recordId: string;
  /** The Box folder the resolve step landed on. */
  folderId: string;
};

/** Long enough to draw, short enough that a leaked token is not a standing capability. */
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export class DestinationConfigError extends Error {}

function signingKey(): Buffer {
  // Any long server-only secret will do; the service-role key is the one that is always
  // present when the app can work at all. Hashed so the raw key never touches the HMAC.
  const secret =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? process.env.CRON_SECRET;
  if (!secret) {
    throw new DestinationConfigError("No server secret is configured to sign Box destinations.");
  }
  return createHash("sha256").update(`box-destination:${secret}`).digest();
}

function mac(d: Destination, expires: number): Buffer {
  return createHmac("sha256", signingKey())
    .update(`${d.kind}\n${d.recordId}\n${d.folderId}\n${expires}`)
    .digest();
}

export function signDestination(d: Destination): string {
  const expires = Date.now() + TOKEN_TTL_MS;
  return `${expires}.${mac(d, expires).toString("base64url")}`;
}

export type DestinationCheck = "ok" | "missing" | "expired" | "mismatch";

export function verifyDestination(token: string | undefined, d: Destination): DestinationCheck {
  if (!token) return "missing";
  const dot = token.indexOf(".");
  if (dot <= 0) return "mismatch";
  const expires = Number(token.slice(0, dot));
  if (!Number.isFinite(expires)) return "mismatch";
  let presented: Buffer;
  try {
    presented = Buffer.from(token.slice(dot + 1), "base64url");
  } catch {
    return "mismatch";
  }
  const expected = mac(d, expires);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return "mismatch";
  if (Date.now() > expires) return "expired";
  return "ok";
}

/** The message the operator sees; every failure has the same fix. */
export function destinationProblem(check: Exclude<DestinationCheck, "ok">): string {
  return check === "expired"
    ? "That destination was resolved more than two hours ago — press Find again, then upload."
    : "The destination doesn't match what was resolved — press Find again, then upload.";
}
