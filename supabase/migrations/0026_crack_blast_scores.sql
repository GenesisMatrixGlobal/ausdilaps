-- CrackBlast high scores — the staff-wide leaderboard behind the `crack-blast` game.
--
-- Same shape and rules as 0014 (site_snap_scores), deliberately: per-game typed table (the
-- generic `game_runs` merge was proposed and declined on 2026-09-08), best run per person,
-- player name denormalised so the board still reads after someone leaves.
--
-- IDEMPOTENT: safe to run repeatedly.

create table if not exists public.crack_blast_scores (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  player_name   text not null,
  score         int  not null check (score >= 0),
  lines_cleared int  not null default 0 check (lines_cleared >= 0),
  best_combo    int  not null default 0 check (best_combo >= 0),
  wall_reached  int  not null default 1 check (wall_reached >= 1),
  moves         int  not null default 0 check (moves >= 0),
  duration_ms   int  not null default 0 check (duration_ms >= 0),
  played_at     timestamptz not null default now()
);

-- Columns go here as well as in the create: `create table if not exists` is a no-op on a
-- database that already has the table.
alter table public.crack_blast_scores
  add column if not exists lines_cleared int not null default 0,
  add column if not exists best_combo    int not null default 0,
  add column if not exists wall_reached  int not null default 1,
  add column if not exists moves         int not null default 0,
  add column if not exists duration_ms   int not null default 0;

-- One row per player. PLAIN unique index — PostgREST cannot send a partial predicate.
create unique index if not exists crack_blast_scores_user_idx
  on public.crack_blast_scores(user_id);

-- Ties break on whoever got there first.
create index if not exists crack_blast_scores_board_idx
  on public.crack_blast_scores(score desc, played_at asc);

alter table public.crack_blast_scores enable row level security;

-- is_staff(), NOT is_internal() (admin-only). Writes are service-role only via the API,
-- which takes the name from the session, so nobody can post as someone else.
drop policy if exists "crack blast scores staff read" on public.crack_blast_scores;
create policy "crack blast scores staff read" on public.crack_blast_scores for select
  using (public.is_staff());

notify pgrst, 'reload schema';
