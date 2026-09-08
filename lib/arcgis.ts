// One guard against the worst habit of the ArcGIS REST API: a FAILED query is answered with
// HTTP 200 and a body of `{"error": {...}}` — no `features` key at all.
//
// Every reader in this repo did `body.features ?? []` and got an empty list, which is
// indistinguishable from "there is genuinely nothing here". The cadastre tools then told the
// operator "no titled parcel at this address — measure manually", blaming the address for a
// service outage. That happened for real on 2026-09-08: VIC's Vicmap_Parcel layer started
// rejecting every spatial query that returns records (counts still worked), and the Building
// Markup tool reported perfectly ordinary Newport addresses as having no parcel.
//
// So: check for the error object before trusting an empty result. A service that is down must
// read as a service that is down.

export interface ArcgisQueryBody {
  error?: { code?: number; message?: string; details?: string[] };
}

/**
 * A human-readable description of an ArcGIS error body, or null if the body isn't one.
 *
 * Both `message` and `details` are used, because ArcGIS sometimes sends a blank message with
 * the only useful text in `details` (`returnIdsOnly` and `f=pbf` both do this), and a thrown
 * error reading "ArcGIS query failed:" with nothing after it is barely better than the silence
 * it replaced.
 */
export function arcgisErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as ArcgisQueryBody).error;
  if (!error || typeof error !== "object") return null;
  const parts = [
    error.message?.trim(),
    ...(Array.isArray(error.details) ? error.details.map((d) => String(d).trim()) : []),
  ].filter((p): p is string => Boolean(p));
  const text = [...new Set(parts)].join(" — ") || "no detail given";
  return error.code ? `${text} (code ${error.code})` : text;
}

/** Throws if the body is an ArcGIS error, naming the service so the message says which one
 *  broke. For load-bearing queries — a markup without a boundary is not a markup, and the
 *  operator needs to know it was the service and not their address. */
export function assertNoArcgisError(body: unknown, service: string): void {
  const message = arcgisErrorMessage(body);
  if (message) throw new Error(`${service} rejected the query: ${message}`);
}
