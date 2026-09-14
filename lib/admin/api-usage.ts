// Read-back for /admin/usage: what each tool spent on third-party APIs this month and last
// (migration 0018, written by lib/api-usage.ts). Grouped in SQL by api_usage_summary() so a
// busy month never has to page through raw rows.

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTool } from "@/lib/tools/registry";
import { GOOGLE_CENTS_PER_REQUEST, GOOGLE_FREE_REQUESTS_PER_MONTH, type GoogleApi } from "@/lib/api-usage";

export interface UsageRow {
  tool: string | null;
  provider: string;
  api: string;
  calls: number;
  units: number;
  /** After Google's free monthly allowance — what the invoice should show. */
  costCents: number;
  /** Before it — what the same calls would cost at list. */
  listCents: number;
}

export interface UsageMonth {
  /** "September 2026" */
  label: string;
  from: Date;
  to: Date;
  rows: UsageRow[];
  totalCents: number;
  totalListCents: number;
  totalCalls: number;
}

export interface ApiUsage {
  month: UsageMonth;
  lastMonth: UsageMonth;
  unavailable?: string;
}

/** Calendar months in Brisbane time (UTC+10, no daylight saving) — the business's month,
 *  not UTC's, so a call at 8am on the 1st lands in the right month. */
function brisbaneMonthStart(offsetMonths: number): Date {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", year: "numeric", month: "numeric" }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value) - 1;
  return new Date(Date.UTC(y, m + offsetMonths, 1, -10));
}

function monthLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", month: "long", year: "numeric" }).format(
    new Date(d.getTime() + 12 * 3600 * 1000)
  );
}

async function loadMonth(from: Date, to: Date): Promise<UsageMonth> {
  const { data, error } = await createAdminClient().rpc("api_usage_summary", {
    since: from.toISOString(),
    until_at: to.toISOString(),
  });
  if (error) throw error;
  const raw = ((data ?? []) as { tool: string | null; provider: string; api: string; calls: number | string; units: number | string; cost_cents: number | string }[]).map((r) => ({
    tool: r.tool,
    provider: r.provider,
    api: r.api,
    calls: Number(r.calls),
    units: Number(r.units),
    listCents: Number(r.cost_cents),
  }));
  const rows = applyGoogleFreeAllowance(raw);
  return {
    label: monthLabel(from),
    from,
    to,
    rows,
    totalCents: rows.reduce((s, r) => s + r.costCents, 0),
    totalListCents: rows.reduce((s, r) => s + r.listCents, 0),
    totalCalls: rows.reduce((s, r) => s + r.calls, 0),
  };
}

/** Google bills only the requests past each API's free monthly allowance, account-wide. The
 *  allowance is spent across every tool that used the API, so each tool's row carries its
 *  share of the BILLED fraction: 12,000 geocodes across two tools → the two rows together
 *  cost 2,000 requests' worth, split in proportion to their counts. Anthropic and ArcGIS rows
 *  pass through unchanged. */
function applyGoogleFreeAllowance(rows: Omit<UsageRow, "costCents">[]): UsageRow[] {
  const totalByApi = new Map<string, number>();
  for (const r of rows) if (r.provider === "google") totalByApi.set(r.api, (totalByApi.get(r.api) ?? 0) + r.units);
  return rows.map((r) => {
    if (r.provider !== "google") return { ...r, costCents: r.listCents };
    const total = totalByApi.get(r.api) ?? 0;
    const free = GOOGLE_FREE_REQUESTS_PER_MONTH[r.api as GoogleApi] ?? 0;
    const billedFraction = total > free ? (total - free) / total : 0;
    return { ...r, costCents: Math.round(r.listCents * billedFraction * 10_000) / 10_000 };
  });
}

export async function loadApiUsage(): Promise<ApiUsage> {
  const thisStart = brisbaneMonthStart(0);
  const nextStart = brisbaneMonthStart(1);
  const lastStart = brisbaneMonthStart(-1);
  const empty = (from: Date, to: Date): UsageMonth => ({ label: monthLabel(from), from, to, rows: [], totalCents: 0, totalListCents: 0, totalCalls: 0 });
  try {
    const [month, lastMonth] = await Promise.all([loadMonth(thisStart, nextStart), loadMonth(lastStart, thisStart)]);
    return { month, lastMonth };
  } catch (e) {
    return {
      month: empty(thisStart, nextStart),
      lastMonth: empty(lastStart, thisStart),
      unavailable: `API usage isn't available: ${(e as Error).message}. Has migration 0018 been applied?`,
    };
  }
}

/** Display name for a `tool` value — a registry slug, one of the named jobs, or nothing. */
export function toolTitle(tool: string | null): string {
  if (!tool) return "Unattributed";
  if (tool === "knowledge-index") return "Knowledge base indexing";
  return getTool(tool)?.title ?? tool;
}

const API_LABEL: Record<string, string> = {
  geocoding: "Geocoding (address ↔ point)",
  places_autocomplete: "Places autocomplete",
  places_details: "Place details",
  static_maps: "Static Maps tiles",
  street_view_static: "Street View images",
  street_view_metadata: "Street View metadata (free)",
  directions: "Directions",
  messages: "Claude vision / text",
  query: "State cadastre (ArcGIS, free)",
};

export function apiLabel(provider: string, api: string): string {
  return API_LABEL[api] ?? `${provider} ${api}`;
}

/** List unit price for a Google API, for the per-API table's "each" column. */
export function unitPriceCents(provider: string, api: string): number | null {
  if (provider === "google" && api in GOOGLE_CENTS_PER_REQUEST) return GOOGLE_CENTS_PER_REQUEST[api as GoogleApi];
  if (provider === "arcgis") return 0;
  return null;
}

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
