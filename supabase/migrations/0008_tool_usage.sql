-- Tool usage — how often each staff tool is actually used.
--
-- Answers one question for /admin/tools: which tools earn their keep. A tool sitting at
-- zero is the interesting case — either nobody needs it, or nobody knows it exists.
--
-- DELIBERATELY NO USER ID. The question is which tools get used, not who is using them.
-- Adding a user column later is a migration; removing it after staff notice they were
-- being tracked is a conversation. There is no department column either, for a duller
-- reason: the API routes don't know which department the person is acting in, so it would
-- be null on every row — exactly the mistake profiles.last_seen_at made.
--
-- Rows are cheap and append-only. At a few thousand a year this needs no retention policy;
-- revisit if it ever reaches millions.
--
-- IDEMPOTENT: safe to run repeatedly.

create table if not exists public.tool_usage (
  id        uuid primary key default gen_random_uuid(),
  -- Matches a slug in lib/tools/registry.ts. Not a foreign key: the registry lives in
  -- code, and history for a retired tool should survive its removal from that array.
  tool_slug text not null,
  used_at   timestamptz not null default now()
);

-- "Last 30 days" is the only shape /admin and /admin/tools ask for.
create index if not exists tool_usage_used_at_idx on public.tool_usage(used_at desc);
create index if not exists tool_usage_tool_idx    on public.tool_usage(tool_slug, used_at desc);

-- ── Row Level Security ──────────────────────────────────────────────────
alter table public.tool_usage enable row level security;

-- Internal read only, writes via the service-role client — same as leads.
drop policy if exists "tool usage internal read" on public.tool_usage;
create policy "tool usage internal read" on public.tool_usage for select
  using (public.is_internal());
