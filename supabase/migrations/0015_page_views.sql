-- Page views — how often the sample report library is looked at, and how people get in.
--
-- Answers one question for /admin: is anyone reading the samples? Google Analytics can say
-- the same, but it is not connected to the dashboard and an estimator will not open it.
-- One row per event, written from proxy.ts (the gate already runs on every request to the
-- page) and from the email-unlock route.
--
-- `event` values, all written by lib/page-views.ts:
--   view_locked         the teaser page rendered (no cookie)
--   view_library        the unlocked list rendered (cookie present)
--   unlock_code         a valid access code arrived in the URL
--   unlock_code_failed  a wrong code arrived
--   unlock_email        name + email given on the locked page
--
-- DELIBERATELY NO IP AND NO USER. The question is volume, not who. `referrer` and the
-- user-agent family are kept because "did the link on the quote get clicked" and "how much
-- of this is bots" are the two follow-up questions, and both are answerable from them.
--
-- Rows are cheap and append-only. Revisit retention if it ever reaches millions.
--
-- IDEMPOTENT: safe to run repeatedly.
-- After applying: `notify pgrst, 'reload schema';` or PostgREST keeps its cached schema.

create table if not exists public.page_views (
  id          uuid primary key default gen_random_uuid(),
  path        text not null,
  event       text not null,
  occurred_at timestamptz not null default now(),
  referrer    text,
  user_agent  text
);

create index if not exists page_views_path_time_idx on public.page_views(path, occurred_at desc);
create index if not exists page_views_time_idx      on public.page_views(occurred_at desc);

-- ── Row Level Security ──────────────────────────────────────────────────
alter table public.page_views enable row level security;

-- Internal read only, writes via the service-role client — same as tool_usage.
drop policy if exists "page views internal read" on public.page_views;
create policy "page views internal read" on public.page_views for select
  using (public.is_internal());

notify pgrst, 'reload schema';
