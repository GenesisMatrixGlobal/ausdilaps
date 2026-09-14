// Read-back for /admin/usage: what each tool spent on third-party APIs this month and last
// (migration 0018, written by lib/api-usage.ts). Grouped in SQL by api_usage_summary() so a
// busy month never has to page through raw rows.

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTool } from "@/lib/tools/registry";
import { GOOGLE_CENTS_PER_REQUEST, type GoogleApi } from "@/lib/api-usage";

export interface UsageRow {
  tool: string | null;
  provider: string;
  api: string;
  calls: number;
  units: number;
  costCents: number;
}

export interface UsageMonth {
  /** "September 2026" */
  label: string;
  from: Date;
  to: Date;
  rows: UsageRow[];
  totalCents: number;
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
  const rows: UsageRow[] = ((data ?? []) as { tool: string | null; provider: string; api: string; calls: number | string; units: number | string; cost_cents: number | string }[]).map((r) => ({
    tool: r.tool,
    provider: r.provider,
    api: r.api,
    calls: Number(r.calls),
    units: Number(r.units),
    costCents: Number(r.cost_cents),
  }));
  return {
    label: monthLabel(from),
    from,
    to,
    rows,
    totalCents: rows.reduce((s, r) => s + r.costCents, 0),
    totalCalls: rows.reduce((s, r) => s + r.calls, 0),
  };
}

export async function loadApiUsage(): Promise<ApiUsage> {
  const thisStart = brisbaneMonthStart(0);
  const nextStart = brisbaneMonthStart(1);
  const lastStart = brisbaneMonthStart(-1);
  const empty = (from: Date, to: Date): UsageMonth => ({ label: monthLabel(from), from, to, rows: [], totalCents: 0, totalCalls: 0 });
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
