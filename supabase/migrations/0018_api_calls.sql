-- API calls — what the staff tools spend on Google Maps Platform and Anthropic, per call.
--
-- Answers one question for /admin/usage: what is each tool costing us this month? Google
-- cannot split a bill by tool (every tool shares one key) and neither can Anthropic, so the
-- split has to be counted here, at the point we make the call. One row per outbound call,
-- written by lib/api-usage.ts.
--
--   provider    'google' | 'anthropic' | 'arcgis'
--   api         which endpoint: geocoding, places_autocomplete, places_details, static_maps,
--               street_view_static, street_view_metadata, directions, messages (Anthropic),
--               query (ArcGIS — free, counted so a spike still shows)
--   tool        the tool slug from lib/tools/registry.ts, or a job name for things with no
--               page (knowledge-index, tender-watch); null when unattributable
--   units       requests for Google/ArcGIS; for Anthropic, 1 per message
--   cost_cents  OUR ESTIMATE at list price — the invoice is the truth; this is the split
--   meta        model + token counts for Anthropic, nothing else
--
-- No user, no IP: the question is spend, not who.
--
-- IDEMPOTENT: safe to run repeatedly.
-- After applying: `notify pgrst, 'reload schema';` or PostgREST keeps its cached schema.

create table if not exists public.api_calls (
  id          bigint generated always as identity primary key,
  called_at   timestamptz not null default now(),
  provider    text not null,
  api         text not null,
  tool        text,
  units       integer not null default 1,
  cost_cents  numeric(12,4) not null default 0,
  meta        jsonb
);

create index if not exists api_calls_time_idx      on public.api_calls(called_at desc);
create index if not exists api_calls_tool_time_idx on public.api_calls(tool, called_at desc);

alter table public.api_calls enable row level security;

drop policy if exists "api calls internal read" on public.api_calls;
create policy "api calls internal read" on public.api_calls for select
  using (public.is_internal());

-- Grouped totals for a window, so the dashboard never pages through raw rows (PostgREST caps
-- a select at 1,000 rows, which a busy month would pass).
create or replace function public.api_usage_summary(since timestamptz, until_at timestamptz)
returns table (tool text, provider text, api text, calls bigint, units bigint, cost_cents numeric)
language sql
stable
security invoker
as $$
  select tool, provider, api, count(*)::bigint, sum(units)::bigint, sum(cost_cents)
  from public.api_calls
  where called_at >= since and called_at < until_at
  group by tool, provider, api
$$;

notify pgrst, 'reload schema';
