// Read-back for /admin/usage: what each tool spent on third-party APIs this month and last
// (migration 0018, written by lib/api-usage.ts). Grouped in SQL by api_usage_summary() so a
// busy month never has to page through raw rows.

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTool } from "@/lib/tools/registry";
import {
  DEEPGRAM_CENTS_PER_MINUTE,
  GOOGLE_CENTS_PER_REQUEST,
  GOOGLE_FREE_REQUESTS_PER_MONTH,
  type GoogleApi,
} from "@/lib/api-usage";

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
  /** "2026-09" — the month shown, for the ?month= navigation on /admin/usage. */
  monthKey: string;
  prevKey: string;
  /** null when the month shown is the current one: there is no next month to look at yet. */
  nextKey: string | null;
  unavailable?: string;
}

/** Calendar months in Brisbane time (UTC+10, no daylight saving) — the business's month,
 *  not UTC's, so a call at 8am on the 1st lands in the right month. */
function brisbaneYearMonth(): [year: number, month0: number] {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", year: "numeric", month: "numeric" }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value) - 1;
  return [y, m];
}

/** Midnight Brisbane on the 1st of the given month, `offsetMonths` from it. */
function monthStart(y: number, m0: number, offsetMonths = 0): Date {
  return new Date(Date.UTC(y, m0 + offsetMonths, 1, -10));
}

function keyOf(y: number, m0: number): string {
  const d = new Date(Date.UTC(y, m0, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-09" → [2026, 8]; anything else → the current Brisbane month. A month in the future
 *  is clamped to the current one — there is nothing there to show. */
function parseMonthKey(key: string | undefined): [number, number] {
  const [cy, cm] = brisbaneYearMonth();
  const m = key ? /^(\d{4})-(\d{2})$/.exec(key) : null;
  if (!m) return [cy, cm];
  const y = Number(m[1]);
  const m0 = Number(m[2]) - 1;
  if (m0 < 0 || m0 > 11) return [cy, cm];
  if (y > cy || (y === cy && m0 > cm)) return [cy, cm];
  return [y, m0];
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

/** The month named by `monthKey` ("2026-08"; default the current one) and the month before
 *  it, so any month can be compared with its predecessor, not only this one with last. */
export async function loadApiUsage(monthKey?: string): Promise<ApiUsage> {
  const [y, m0] = parseMonthKey(monthKey);
  const [cy, cm] = brisbaneYearMonth();
  const thisStart = monthStart(y, m0);
  const nextStart = monthStart(y, m0, 1);
  const lastStart = monthStart(y, m0, -1);
  const isCurrent = y === cy && m0 === cm;
  const nav = { monthKey: keyOf(y, m0), prevKey: keyOf(y, m0 - 1), nextKey: isCurrent ? null : keyOf(y, m0 + 1) };
  const empty = (from: Date, to: Date): UsageMonth => ({ label: monthLabel(from), from, to, rows: [], totalCents: 0, totalListCents: 0, totalCalls: 0 });
  try {
    const [month, lastMonth] = await Promise.all([loadMonth(thisStart, nextStart), loadMonth(lastStart, thisStart)]);
    return { month, lastMonth, ...nav };
  } catch (e) {
    return {
      month: empty(thisStart, nextStart),
      lastMonth: empty(lastStart, thisStart),
      ...nav,
      unavailable: `API usage isn't available: ${(e as Error).message}. Has migration 0018 been applied?`,
    };
  }
}

export interface ToolUsage {
  /** "September 2026" */
  monthLabel: string;
  calls: number;
  costCents: number;
  byApi: { provider: string; api: string; label: string; calls: number; units: number; unitLabel: string; costCents: number }[];
}

/**
 * One tool's month to date, for the counter inside the tool itself. The same rows /admin/usage
 * shows, filtered — so the figure on the tool and the figure on the dashboard are one figure.
 * Google's free allowance is applied account-wide first, exactly as the dashboard does it.
 */
export async function loadToolUsage(slug: string): Promise<ToolUsage> {
  const [y, m0] = brisbaneYearMonth();
  const month = await loadMonth(monthStart(y, m0), monthStart(y, m0, 1));
  const rows = month.rows.filter((r) => r.tool === slug);
  return {
    monthLabel: month.label,
    calls: rows.reduce((s, r) => s + r.calls, 0),
    costCents: rows.reduce((s, r) => s + r.costCents, 0),
    byApi: rows
      .map((r) => ({ provider: r.provider, api: r.api, label: apiLabel(r.provider, r.api), calls: r.calls, units: r.units, unitLabel: unitLabel(r.provider, r.api, r.units), costCents: r.costCents }))
      .sort((a, b) => b.costCents - a.costCents),
  };
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
  listen: "Deepgram transcription (per audio minute)",
};

export function apiLabel(provider: string, api: string): string {
  return API_LABEL[api] ?? `${provider} ${api}`;
}

/** What a row's `units` counts — Deepgram bills audio minutes, Google requests, Anthropic
 *  rows are one call each (the tokens are in meta). */
export function unitLabel(provider: string, api: string, count = 2): string {
  const one = count === 1;
  if (provider === "deepgram") return "min";
  if (provider === "google") return api === "static_maps" ? (one ? "tile" : "tiles") : one ? "request" : "requests";
  if (provider === "anthropic") return one ? "call" : "calls";
  if (provider === "arcgis") return one ? "query" : "queries";
  return one ? "unit" : "units";
}

/** List unit price for a Google API, for the per-API table's "each" column. */
export function unitPriceCents(provider: string, api: string): number | null {
  if (provider === "google" && api in GOOGLE_CENTS_PER_REQUEST) return GOOGLE_CENTS_PER_REQUEST[api as GoogleApi];
  if (provider === "arcgis") return 0;
  if (provider === "deepgram") return DEEPGRAM_CENTS_PER_MINUTE;
  return null;
}

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
