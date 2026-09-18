// What the staff tools spend on third-party APIs, counted where the calls are made
// (migration 0018). Read back by lib/admin/api-usage.ts for /admin/usage.
//
// Google cannot split a bill per tool — every tool shares one key — and neither can
// Anthropic. So each outbound call records ONE row here: which API, which tool, and what it
// cost at list price. The invoice is the truth; this is the split, and a ceiling.
//
// NEVER throws, never blocks the caller. Call it as `void recordApiCall(...)`; the insert is
// handed to `after()` when there is a request to outlive, so the response is not held up.
//
// Deliberately NOT importing "server-only" or next/headers statically: lib/knowledge/ai.ts
// and lib/tenders/classify.ts run from tsx scripts and the cron as well as from routes.

export type ApiProvider = "google" | "anthropic" | "arcgis" | "deepgram";

export type GoogleApi =
  | "geocoding"
  | "places_autocomplete"
  | "places_details"
  | "static_maps"
  | "street_view_static"
  | "street_view_metadata"
  | "directions";

/** Google Maps Platform list price, CENTS PER REQUEST (pay-as-you-go, no free allowance
 *  applied — Google gives every account a monthly free tier per SKU, so the invoice will be
 *  LOWER than this). Geocoding/Directions $5 per 1,000; Places Autocomplete (New) $2.83;
 *  Place Details (Essentials) $5; Static Maps $2; Street View Static $7; metadata free. */
export const GOOGLE_CENTS_PER_REQUEST: Record<GoogleApi, number> = {
  geocoding: 0.5,
  places_autocomplete: 0.283,
  places_details: 0.5,
  static_maps: 0.2,
  street_view_static: 0.7,
  street_view_metadata: 0,
  directions: 0.5,
};

/** Google Maps Platform's monthly free allowance, REQUESTS PER API (SKU) PER CALENDAR MONTH,
 *  on standard pay-as-you-go pricing (March 2025 model). Every API this app calls is an
 *  "Essentials" SKU, which carries 10,000 free requests a month; only usage past that is
 *  billed. Applied at READ time (lib/admin/api-usage.ts), never when a row is written, so a
 *  change here re-prices history and the raw counts stay honest. Assumes this app is the only
 *  user of the key — it is. */
export const GOOGLE_FREE_REQUESTS_PER_MONTH: Record<GoogleApi, number> = {
  geocoding: 10_000,
  places_autocomplete: 10_000,
  places_details: 10_000,
  static_maps: 10_000,
  street_view_static: 10_000,
  street_view_metadata: Infinity,
  directions: 10_000,
};

/** Anthropic list price in DOLLARS PER MILLION tokens, by model-id prefix. Cache reads bill at
 *  a tenth of input, cache writes at 1.25x. An unknown model records tokens with cost null. */
const ANTHROPIC_USD_PER_MTOK: [prefix: string, input: number, output: number][] = [
  ["claude-fable-5", 10, 50],
  ["claude-mythos-5", 10, 50],
  ["claude-opus-5", 5, 25],
  ["claude-opus-4", 5, 25],
  ["claude-sonnet-5", 2, 10],
  ["claude-sonnet-4-6", 3, 15],
  ["claude-sonnet-4", 3, 15],
  ["claude-haiku-4", 1, 5],
];

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export function anthropicCostCents(model: string, usage: AnthropicUsage | undefined): number | null {
  const price = ANTHROPIC_USD_PER_MTOK.find(([prefix]) => model.startsWith(prefix));
  if (!price || !usage) return null;
  const [, inUsd, outUsd] = price;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const usd = (input * inUsd + cacheRead * inUsd * 0.1 + cacheWrite * inUsd * 1.25 + output * outUsd) / 1_000_000;
  return Math.round(usd * 100 * 10_000) / 10_000;
}

/** Deepgram Nova-3 pre-recorded, list price in CENTS PER AUDIO MINUTE (pay-as-you-go,
 *  $0.0043/min), plus the keyterm-prompting add-on ($0.0013/min) when a request carries
 *  keyterms. Deepgram pro-rates to the second; `units` below is minutes ROUNDED UP, so the
 *  dashboard reads as a ceiling, which is the rule for every provider here. */
export const DEEPGRAM_CENTS_PER_MINUTE = 0.43;
export const DEEPGRAM_KEYTERM_CENTS_PER_MINUTE = 0.13;

export function deepgramCostCents(seconds: number, keyterms: boolean): number {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const perMinute = DEEPGRAM_CENTS_PER_MINUTE + (keyterms ? DEEPGRAM_KEYTERM_CENTS_PER_MINUTE : 0);
  return Math.round(minutes * perMinute * 10_000) / 10_000;
}

export type ApiCall =
  | { provider: "google"; api: GoogleApi; units?: number; tool?: string }
  | { provider: "arcgis"; api: "query"; units?: number; tool?: string }
  | { provider: "anthropic"; api: "messages"; model: string; usage: AnthropicUsage | undefined; tool?: string }
  | { provider: "deepgram"; api: "listen"; model: string; seconds: number; keyterms: boolean; tool?: string };

/** Production only — there is no dev database, so a localhost call would land as a real
 *  cost on the live dashboard. `API_USAGE_LOG=1` prints the row instead, for checking the
 *  attribution locally. */
function recording(): "db" | "log" | "off" {
  if (process.env.VERCEL_ENV === "production") return "db";
  if (process.env.API_USAGE_LOG === "1") return "log";
  return "off";
}

/** Which tool made the call: the STAFF PAGE the browser fetched from, read off the Referer
 *  (same-origin fetches carry the full URL under strict-origin-when-cross-origin). Every tool
 *  lives at /staff/<department>/tools/<slug>, so the slug is right there and no route has to
 *  say which tool it belongs to. Outside a request (scripts, cron) there is no header, and the
 *  caller passes the tool by hand. */
async function toolFromRequest(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const referer = (await headers()).get("referer");
    if (!referer) return null;
    const m = /\/staff\/[^/]+\/tools\/([^/?#]+)/.exec(new URL(referer).pathname);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export async function recordApiCall(call: ApiCall): Promise<void> {
  const mode = recording();
  if (mode === "off") return;
  try {
    const tool = call.tool ?? (await toolFromRequest());
    const row: {
      provider: ApiProvider;
      api: string;
      tool: string | null;
      units: number;
      cost_cents: number;
      meta: Record<string, unknown> | null;
    } =
      call.provider === "anthropic"
        ? {
            provider: "anthropic",
            api: "messages",
            tool,
            units: 1,
            cost_cents: anthropicCostCents(call.model, call.usage) ?? 0,
            meta: { model: call.model, ...(call.usage ?? {}) },
          }
        : call.provider === "deepgram"
          ? {
              provider: "deepgram",
              api: "listen",
              tool,
              units: Math.max(1, Math.ceil(call.seconds / 60)),
              cost_cents: deepgramCostCents(call.seconds, call.keyterms),
              meta: { model: call.model, seconds: Math.round(call.seconds), keyterms: call.keyterms },
            }
          : {
              provider: call.provider,
              api: call.api,
              tool,
              units: call.units ?? 1,
              // Every provider needs its own arm here — a new one falling through to this 0
              // shows on /admin/usage as free, which is how Deepgram nearly did.
              cost_cents: call.provider === "google" ? GOOGLE_CENTS_PER_REQUEST[call.api] * (call.units ?? 1) : 0,
              meta: null,
            };
    if (mode === "log") {
      console.log("[api-usage]", JSON.stringify(row));
      return;
    }
    const insert = async () => {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      // ⚠️ Supabase RETURNS errors rather than throwing.
      const { error } = await createAdminClient().from("api_calls").insert(row);
      if (error) throw error;
    };
    // Inside a request, `after()` keeps the insert alive past the response. Outside one
    // (a script, the cron) it throws, and the insert is simply awaited.
    try {
      const { after } = await import("next/server");
      after(() => insert().catch((e) => console.error("[api-usage] failed to record:", (e as Error).message)));
    } catch {
      await insert();
    }
  } catch (e) {
    console.error("[api-usage] failed to record:", (e as Error).message);
  }
}
