-- Site Snap high scores — the leaderboard behind the `site-snap` staff tool.
--
-- A break-room game, not a business system. It is here as a case study for how far a tool can
-- go on the existing registry + API + RLS pattern without any new plumbing.
--
-- Player name is DENORMALISED on purpose: the board should still read correctly after someone
-- leaves and their profile is deactivated, and joining profiles on every read to render ten
-- rows is not worth it. user_id stays, for "your best run".
--
-- IDEMPOTENT: safe to run repeatedly.

create table if not exists public.site_snap_scores (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  player_name    text not null,
  score          int  not null check (score >= 0),
  -- Kept beside the score so the board can show HOW a run was won — a fast sloppy run and a
  -- slow thorough one can total the same, and seeing which is which is most of the fun.
  walls_captured int  not null default 0 check (walls_captured >= 0),
  avg_quality    int  not null default 0 check (avg_quality between 0 and 100),
  elapsed_ms     int  not null default 0 check (elapsed_ms >= 0),
  played_at      timestamptz not null default now()
);

-- Columns must be added here as well as in the create above: `create table if not exists` is
-- a no-op on a database that already has the table, so anything added only inside it would
-- silently never land.
alter table public.site_snap_scores
  add column if not exists walls_captured int not null default 0,
  add column if not exists avg_quality    int not null default 0,
  add column if not exists elapsed_ms     int not null default 0;

-- One row per player: the board is "best run per person", so an upsert on user_id beats
-- storing every run and taking a max. A PLAIN unique index, not a partial one — PostgREST
-- cannot express a predicate in `on conflict`.
create unique index if not exists site_snap_scores_user_idx
  on public.site_snap_scores(user_id);

-- Ties are likely (integer scores, a fixed house), so break them on the faster run.
create index if not exists site_snap_scores_board_idx
  on public.site_snap_scores(score desc, elapsed_ms asc);

-- ── Row Level Security ──────────────────────────────────────────────────
-- 0007 installs an event trigger that auto-enables RLS on every new public table, so this is
-- belt and braces rather than the only thing standing here.
alter table public.site_snap_scores enable row level security;

-- is_staff(), NOT is_internal(). is_internal() (0001_init.sql:69) is admin/superadmin only —
-- using it here would hide the leaderboard from every ordinary staff member on any
-- RLS-scoped read, which is exactly the mistake the knowledge base made in 0009 and had to
-- correct. Writes are service-role only, so there is deliberately no insert or update policy:
-- the API sets player_name from the session, so nobody can post a score as someone else.
drop policy if exists "site snap scores staff read" on public.site_snap_scores;
create policy "site snap scores staff read" on public.site_snap_scores for select
  using (public.is_staff());

-- Without this PostgREST keeps serving its cached schema and every read of the new table
-- comes back as "Could not find the table in the schema cache".
notify pgrst, 'reload schema';
