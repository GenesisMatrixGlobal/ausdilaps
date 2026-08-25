-- Tender Watch — the tender-opportunity pipeline.
-- RSS + monitored inbox → dedupe → classify (Anthropic) → nightly digest (Resend) → /staff + /admin.
--
-- Three tables, three jobs:
--   tender_sources    per-source operator switch + health. Deliberately holds NO url —
--                     feed URLs live in lib/tenders/sources.ts so a database write can
--                     never redirect the nightly fetch at an internal host (SSRF).
--   tender_scan_runs  one row per (run, source), written 'running' BEFORE any work, so a
--                     hard function timeout still leaves evidence behind.
--   tender_items      the tenders. unique(source_slug, external_ref) is the idempotency
--                     key the entire at-least-once design rests on.
--
-- Reads are department-scoped via has_department('accounts') — the 0005 helper, which
-- grants admin/superadmin everything AND checks profiles.is_active (is_internal() does
-- not). No INSERT/UPDATE/DELETE policies: writes go through the service-role client, per
-- the design note at the top of 0001.
--
-- Depends on 0005 for public.has_department() and public.profiles.
-- IDEMPOTENT: safe to run repeatedly.

-- ── Enums ──────────────────────────────────────────────────────────────
-- All brand-new TYPES, so they can sit in the same file as the tables that use them.
-- The 0004 constraint is specifically about `alter type ... add value`, not `create type`.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'tender_source_kind') then
    create type tender_source_kind as enum ('rss', 'email');
  end if;
  if not exists (select 1 from pg_type where typname = 'tender_run_trigger') then
    create type tender_run_trigger as enum ('cron', 'manual', 'replay');
  end if;
  if not exists (select 1 from pg_type where typname = 'tender_run_status') then
    create type tender_run_status as enum ('running', 'succeeded', 'partial', 'failed', 'skipped');
  end if;
  if not exists (select 1 from pg_type where typname = 'tender_relevance') then
    create type tender_relevance as enum ('pending', 'match', 'maybe', 'no_match', 'error');
  end if;
  if not exists (select 1 from pg_type where typname = 'tender_item_status') then
    create type tender_item_status as enum
      ('new', 'reviewing', 'bidding', 'declined', 'submitted', 'archived');
  end if;
end $$;

-- ── tender_sources ─────────────────────────────────────────────────────
-- Operational state only. The URL, sender allowlist and parser for each source live in
-- lib/tenders/sources.ts, matching the lib/departments.ts and lib/tools/registry.ts
-- precedent — code is the source of truth for *what* a source is, the database only
-- remembers how it is *behaving*.
create table if not exists public.tender_sources (
  slug                 text primary key,                 -- matches lib/tenders/sources.ts
  label                text not null,
  kind                 tender_source_kind not null,
  -- operator control
  is_enabled           boolean not null default true,
  -- health, maintained by the scanner, read by the dashboard
  last_run_at          timestamptz,
  last_success_at      timestamptz,
  last_item_at         timestamptz,                      -- last run that yielded ANY item
  consecutive_failures int not null default 0,
  -- The silent-failure counter. A portal that stops emailing us produces zero errors and
  -- a green run; only a count of *nothing happened* catches it.
  consecutive_empty    int not null default 0,
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists trg_tender_source_updated on public.tender_sources;
create trigger trg_tender_source_updated before update on public.tender_sources
  for each row execute function public.set_updated_at();

-- ── tender_scan_runs ───────────────────────────────────────────────────
-- One row per (run, source). A cron invocation fans out to N rows sharing a run_group_id,
-- so per-source failure is visible without a fourth table.
-- `triggered_by`, not `trigger` — avoids the Postgres keyword entirely.
create table if not exists public.tender_scan_runs (
  id                uuid primary key default gen_random_uuid(),
  run_group_id      uuid not null,
  source_slug       text not null references public.tender_sources(slug) on update cascade,
  triggered_by      tender_run_trigger not null,
  status            tender_run_status not null default 'running',
  -- the funnel — every stage, so a stage silently going to zero is visible
  items_fetched     int not null default 0,
  items_new         int not null default 0,
  items_duplicate   int not null default 0,
  items_prefiltered int not null default 0,
  items_classified  int not null default 0,
  items_matched     int not null default 0,
  items_forwarded   int not null default 0,
  items_errored     int not null default 0,
  error             text,
  -- Stored BEFORE parsing, always. If a portal changes its format and the parser finds
  -- nothing, the evidence is already here and a fixed parser can be replayed over it —
  -- which converts the worst failure mode from "lost opportunities" into "stale data".
  raw_payload       jsonb,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  duration_ms       int
);

create index if not exists tender_scan_runs_started_at_idx
  on public.tender_scan_runs(started_at desc);
create index if not exists tender_scan_runs_group_idx
  on public.tender_scan_runs(run_group_id);
create index if not exists tender_scan_runs_source_idx
  on public.tender_scan_runs(source_slug, started_at desc);
-- The stalled-run reaper: a hard function timeout kills the process mid-flight with no
-- chance to write finished_at, so 'running' rows are the only trace it leaves.
create index if not exists tender_scan_runs_stalled_idx
  on public.tender_scan_runs(started_at) where status = 'running';

-- ── tender_items ───────────────────────────────────────────────────────
create table if not exists public.tender_items (
  id                  uuid primary key default gen_random_uuid(),
  -- identity — (source_slug, external_ref) is THE idempotency key. external_ref is always
  -- prefixed with how it was derived ('atm:' / 'guid:' / 'link:' / 'msg:' / 'sha:') so
  -- improving the extractor creates NEW rows rather than silently colliding with old ones.
  -- Never derived from anything the model produced.
  source_slug         text not null references public.tender_sources(slug) on update cascade,
  external_ref        text not null,
  content_hash        text,                     -- cross-source fingerprint (non-unique)
  duplicate_of        uuid references public.tender_items(id) on delete set null,
  -- provenance
  first_seen_run_id   uuid references public.tender_scan_runs(id) on delete set null,
  last_seen_run_id    uuid references public.tender_scan_runs(id) on delete set null,
  -- the tender as published — never model-written
  title               text not null,
  agency              text,
  jurisdiction        text,                     -- 'NSW' / 'QLD' / 'CTH' / ...
  url                 text,                     -- https only, validated before storage
  published_at        timestamptz,
  closes_at           timestamptz,
  -- Plain text, stripped and truncated — exactly what the model saw, which is what you
  -- need when debugging a bad verdict. Storing the source HTML would just park
  -- attacker-controlled markup in our database.
  excerpt             text,
  -- inbound-email provenance (null for rss)
  email_message_id    text,
  email_from          text,
  auth_results        text,                     -- provider SPF/DKIM/DMARC verdict, verbatim
  -- An unverified sender is a signal, never a gate: the item is still stored and still
  -- classified, but it is badged in the UI so nobody trusts it by accident.
  sender_trusted      boolean not null default false,
  -- classification — EVERY field here is untrusted model output, zod-validated on write
  relevance           tender_relevance not null default 'pending',
  confidence          numeric(3,2) check (confidence is null or confidence between 0 and 1),
  services            text[] not null default '{}',
  model_summary       text,
  model_reasoning     text,
  model               text,
  classified_by       text,                     -- 'prefilter' | 'anthropic' | 'duplicate'
  classified_at       timestamptz,
  classify_attempts   int not null default 0,
  classify_error      text,
  injection_suspected boolean not null default false,
  -- forward (Resend). Best-effort; retried off the partial index below.
  forwarded_at        timestamptz,
  forward_attempts    int not null default 0,
  forward_error       text,
  -- human pipeline
  status              tender_item_status not null default 'new',
  reviewed_by         uuid references public.profiles(id) on delete set null,
  reviewed_at         timestamptz,
  review_note         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- THE idempotency key. Every ingest is an upsert on this. Without it, at-least-once
-- delivery (cron retries, resent digests, overlapping runs) duplicates everything and
-- re-emails the team. A unique INDEX, not a table constraint, so it stays idempotent
-- under `create table if not exists` and is still usable as an `on conflict` target.
create unique index if not exists tender_items_source_ref_key
  on public.tender_items(source_slug, external_ref);

-- Default list order on the dashboard. Mirrors leads_created_at_idx.
create index if not exists tender_items_created_at_idx
  on public.tender_items(created_at desc);

-- The default view: actionable, newest first. Partial, because no_match rows will be 90%+
-- of the table within a month and must not bloat the hot index.
create index if not exists tender_items_actionable_idx
  on public.tender_items(created_at desc)
  where relevance in ('match', 'maybe') and status <> 'archived';

-- Resume queue: everything a crashed, timed-out or rate-limited run left behind. This
-- index is what makes a half-finished scan recoverable by simply running again.
create index if not exists tender_items_pending_idx
  on public.tender_items(created_at) where relevance = 'pending';

-- Retry queue for the outbound digest — same shape and purpose as leads_unsynced_idx in
-- 0001. This is how a Resend outage self-heals on the next run.
create index if not exists tender_items_unforwarded_idx
  on public.tender_items(created_at)
  where relevance in ('match', 'maybe') and forwarded_at is null;

-- "Closing this week" in the tool, and the missed-deadline check in the health cron.
create index if not exists tender_items_closes_at_idx
  on public.tender_items(closes_at) where closes_at is not null;

-- Cross-source duplicate lookup. Deliberately NOT unique: two different councils
-- genuinely do both publish "Dilapidation Survey Services", and a unique constraint there
-- would silently discard a real opportunity. Soft-link and show it instead.
create index if not exists tender_items_content_hash_idx
  on public.tender_items(content_hash) where content_hash is not null;

create index if not exists tender_items_source_slug_idx
  on public.tender_items(source_slug, created_at desc);

drop trigger if exists trg_tender_item_updated on public.tender_items;
create trigger trg_tender_item_updated before update on public.tender_items
  for each row execute function public.set_updated_at();
-- No trigger on tender_scan_runs — it is append-then-finalise, and finished_at is set
-- explicitly. An updated_at there would only obscure the real timestamps.

-- ── Row Level Security ──────────────────────────────────────────────────
alter table public.tender_sources   enable row level security;
alter table public.tender_scan_runs enable row level security;
alter table public.tender_items     enable row level security;

-- tender_items: readable by the accounts department (and, via has_department, by any
-- active admin/superadmin). Using a real policy rather than routing every read through
-- the service-role client means the database enforces scope even when the app forgets.
drop policy if exists "tender items staff read" on public.tender_items;
create policy "tender items staff read" on public.tender_items for select
  using (public.has_department('accounts'));

-- Runs and sources stay internal: their error columns carry upstream URLs and provider
-- responses that ordinary staff have no use for.
drop policy if exists "tender runs internal read" on public.tender_scan_runs;
create policy "tender runs internal read" on public.tender_scan_runs for select
  using (public.is_internal());

drop policy if exists "tender sources internal read" on public.tender_sources;
create policy "tender sources internal read" on public.tender_sources for select
  using (public.is_internal());

-- ── ingest upsert — the ONLY place item rows are written ───────────────
-- Invoker rights (NOT security definer): the service-role caller already bypasses RLS,
-- and invoker rights mean this can never become a privilege-escalation path if it is ever
-- mistakenly granted to authenticated.
create or replace function public.tender_upsert_item(p jsonb)
returns table (id uuid, is_new boolean)
language plpgsql as $$
begin
  return query
  insert into public.tender_items (
    source_slug, external_ref, content_hash, title, agency, jurisdiction,
    url, published_at, closes_at, excerpt,
    email_message_id, email_from, auth_results, sender_trusted,
    first_seen_run_id, last_seen_run_id
  )
  select
    p->>'source_slug', p->>'external_ref', nullif(p->>'content_hash', ''),
    p->>'title', nullif(p->>'agency', ''), nullif(p->>'jurisdiction', ''),
    nullif(p->>'url', ''),
    nullif(p->>'published_at', '')::timestamptz,
    nullif(p->>'closes_at', '')::timestamptz,
    nullif(p->>'excerpt', ''),
    nullif(p->>'email_message_id', ''), nullif(p->>'email_from', ''),
    nullif(p->>'auth_results', ''),
    coalesce((p->>'sender_trusted')::boolean, false),
    nullif(p->>'run_id', '')::uuid, nullif(p->>'run_id', '')::uuid
  on conflict (source_slug, external_ref) do update set
    -- Refresh ONLY what the source owns. Never relevance / model_* / forwarded_at /
    -- status / classify_attempts. A careless `do update set` here re-classifies and
    -- re-emails the entire back-catalogue to the team every single night — it is the
    -- highest-consequence line in this migration.
    title            = excluded.title,
    agency           = coalesce(excluded.agency, public.tender_items.agency),
    jurisdiction     = coalesce(excluded.jurisdiction, public.tender_items.jurisdiction),
    closes_at        = coalesce(excluded.closes_at, public.tender_items.closes_at),
    url              = coalesce(excluded.url, public.tender_items.url),
    excerpt          = coalesce(excluded.excerpt, public.tender_items.excerpt),
    last_seen_run_id = excluded.last_seen_run_id,
    updated_at       = now()
  -- xmax = 0 distinguishes an insert from an update, which is what makes items_new an
  -- honest counter. supabase-js `.upsert()` cannot report it.
  returning public.tender_items.id, (xmax = 0) as is_new;
end;
$$;

-- Supabase exposes every public schema function at /rest/v1/rpc/<name>, and Postgres
-- grants EXECUTE to PUBLIC by default. Without these revokes, anyone holding the anon key
-- — which ships in the browser bundle as NEXT_PUBLIC_SUPABASE_ANON_KEY — could write
-- tender rows.
--
-- Revoking from PUBLIC is the load-bearing line; anon and authenticated inherit EXECUTE
-- through it. The explicit per-role revokes are belt-and-braces against a future GRANT.
-- Guarded because those roles are Supabase-provided: on a vanilla cluster (a local dry
-- run) they do not exist, and since scripts/migrate.mjs sends each file as ONE
-- transaction, an unguarded revoke would roll the whole migration back.
revoke all on function public.tender_upsert_item(jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.tender_upsert_item(jsonb) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.tender_upsert_item(jsonb) from authenticated;
  end if;
end $$;

-- ── seed the source registry ───────────────────────────────────────────
-- Mirrors lib/tenders/sources.ts. `do nothing`, not `do update`, so re-running this
-- migration can never stomp an operator's is_enabled = false.
insert into public.tender_sources (slug, label, kind) values
  ('austender-atm',  'AusTender — ATM feed',              'rss'),
  ('buynsw-digest',  'buy.nsw — daily digest email',      'email'),
  ('qtenders-alert', 'QTenders — alert email',            'email'),
  ('direct-invite',  'Direct client tender invitations',  'email')
on conflict (slug) do nothing;
