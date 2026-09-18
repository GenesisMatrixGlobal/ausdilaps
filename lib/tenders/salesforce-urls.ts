/**
 * Salesforce deep links. PURE — no imports, no env, safe in a client bundle.
 *
 * ⚠️ These deliberately do NOT live in salesforce-match.ts. That module imports
 * `@/lib/salesforce` for its SOQL, and the tender queue is a client component: importing the
 * URL builders from there pulls the whole Salesforce client — token flow, secrets handling —
 * into the browser bundle. Exactly the trap `formatCents` hit (see CLAUDE.md), where one
 * formatter dragged `server-only` into the client and white-screened every tool page.
 *
 * The host is a NEXT_PUBLIC_ var because a client component cannot read SF_LOGIN_URL, and a
 * server var read in the browser is `undefined` — which silently falls through to the default
 * and looks like it works right up until the org is renamed.
 */

const DEFAULT_HOST = "ausdilaps.lightning.force.com";

function lightningHost(): string {
  const configured = process.env.NEXT_PUBLIC_SF_LIGHTNING_HOST?.trim();
  return configured ? configured.replace(/^https?:\/\//, "").replace(/\/$/, "") : DEFAULT_HOST;
}

/** Global search — the manual dig the suburb badge cannot replace. */
export function salesforceSearchUrl(term: string): string {
  return `https://${lightningHost()}/lightning/search/result?term=${encodeURIComponent(term)}`;
}

/** Straight to a suspected duplicate. */
export function salesforceRecordUrl(id: string): string {
  return `https://${lightningHost()}/lightning/r/Opportunity/${id}/view`;
}
