// One JSON GET with a timeout, for the free state cadastre / address-layer services and
// Google's geocoder. Nine copies of this existed before 2026-10-05, four of them identical.
//
// AbortController + clearTimeout rather than AbortSignal.timeout, on purpose: it is what every
// copy did and it behaves the same on the Node versions Vercel runs. 12 s is the default
// because the QLD/NSW state-run services answer in well under that; VIC's ArcGIS Online hosted
// layers have been seen taking 12-15 s, so its callers pass 25 s.
import { assertNoArcgisError } from "@/lib/arcgis";

export const FETCH_JSON_TIMEOUT_MS = 12_000;

export type FetchJsonOptions = {
  /** Appended as the query string. */
  params?: URLSearchParams;
  timeoutMs?: number;
  /** When set, an ArcGIS `{error}` body (HTTP 200!) throws, naming this service — see
   *  lib/arcgis.ts for why an empty `features` must never be trusted on its own. */
  arcgisService?: string;
};

export async function fetchJson<T>(
  url: string,
  { params, timeoutMs = FETCH_JSON_TIMEOUT_MS, arcgisService }: FetchJsonOptions = {}
): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(params ? `${url}?${params.toString()}` : url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (arcgisService) assertNoArcgisError(body, arcgisService);
    return body as T;
  } finally {
    clearTimeout(t);
  }
}
