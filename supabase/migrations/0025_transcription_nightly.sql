-- 0025: Transcription Buddy's nightly crawl — its log.
--
-- Every night at 4am Sydney, yesterday's folder in Box "Inspector Uploads"
-- (<year>/<month>/<day>/<initials>) is walked and every recording in it transcribed through
-- the same pipeline the Manual tab uses. These three tables are the automation's log: what
-- was found, what was transcribed, what failed, which inspector folders held no recording,
-- and exactly what the morning report said.
--
-- ⚠️ No counters. Every figure on the Daily runs tab is COUNTED from these rows at read time
-- — tender_scan_runs declared five counters that were never written and the dashboard read
-- "0 matches" above a list of 16. A number that must be kept in step is a number that drifts.
--
-- RLS on with NO policies: only the service role reads or writes, through routes that check
-- the reports department themselves. Transcripts are inspectors' site notes, not public.
--
-- IDEMPOTENT: safe to run repeatedly. Columns are in the create AND in an explicit
-- add-column-if-not-exists, so a table from a partial earlier paste still gets them.

create table if not exists public.transcription_nightly_runs (
  run_date        date primary key,
  day_folder_id   text,
  day_folder_path text,
  status          text not null default 'pending',
  lease_until     timestamptz,
  started_at      timestamptz not null default now(),
  last_tick_at    timestamptz,
  report_sent_at  timestamptz,
  report          jsonb,
  error           text
);
alter table public.transcription_nightly_runs add column if not exists day_folder_id text;
alter table public.transcription_nightly_runs add column if not exists day_folder_path text;
alter table public.transcription_nightly_runs add column if not exists status text not null default 'pending';
alter table public.transcription_nightly_runs add column if not exists lease_until timestamptz;
alter table public.transcription_nightly_runs add column if not exists started_at timestamptz not null default now();
alter table public.transcription_nightly_runs add column if not exists last_tick_at timestamptz;
alter table public.transcription_nightly_runs add column if not exists report_sent_at timestamptz;
alter table public.transcription_nightly_runs add column if not exists report jsonb;
alter table public.transcription_nightly_runs add column if not exists error text;

-- One row per inspector folder found in a day folder. The inspector is resolved from Salesforce
-- Staff__c at discovery and kept, so the log reads the same after someone leaves.
create table if not exists public.transcription_nightly_folders (
  id            uuid primary key default gen_random_uuid(),
  run_date      date not null references public.transcription_nightly_runs(run_date) on delete cascade,
  box_folder_id text not null,
  folder_name   text not null,
  initials      text,
  match_kind    text not null default 'unknown',
  staff_name    text,
  staff_email   text,
  first_seen_at timestamptz not null default now()
);
alter table public.transcription_nightly_folders add column if not exists initials text;
alter table public.transcription_nightly_folders add column if not exists match_kind text not null default 'unknown';
alter table public.transcription_nightly_folders add column if not exists staff_name text;
alter table public.transcription_nightly_folders add column if not exists staff_email text;
alter table public.transcription_nightly_folders add column if not exists first_seen_at timestamptz not null default now();
-- Plain unique index, not partial: on conflict cannot target a partial one through PostgREST.
create unique index if not exists transcription_nightly_folders_key on public.transcription_nightly_folders(run_date, box_folder_id);

-- One row per recording. box_file_id is UNIQUE, which is what makes a recording transcribed
-- once and only once however many ticks see it.
create table if not exists public.transcription_nightly_files (
  id                uuid primary key default gen_random_uuid(),
  run_date          date not null references public.transcription_nightly_runs(run_date) on delete cascade,
  box_file_id       text not null,
  box_folder_id     text not null,
  inspector_folder_id text,
  name              text not null,
  size              bigint not null default 0,
  status            text not null default 'queued',
  attempts          int not null default 0,
  error             text,
  typing            text,
  cleaned           text,
  raw               text,
  flags             int,
  duration_seconds  numeric,
  cost_cents        numeric,
  txt_box_file_id   text,
  txt_error         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.transcription_nightly_files add column if not exists inspector_folder_id text;
alter table public.transcription_nightly_files add column if not exists size bigint not null default 0;
alter table public.transcription_nightly_files add column if not exists status text not null default 'queued';
alter table public.transcription_nightly_files add column if not exists attempts int not null default 0;
alter table public.transcription_nightly_files add column if not exists error text;
alter table public.transcription_nightly_files add column if not exists typing text;
alter table public.transcription_nightly_files add column if not exists cleaned text;
alter table public.transcription_nightly_files add column if not exists raw text;
alter table public.transcription_nightly_files add column if not exists flags int;
alter table public.transcription_nightly_files add column if not exists duration_seconds numeric;
alter table public.transcription_nightly_files add column if not exists cost_cents numeric;
alter table public.transcription_nightly_files add column if not exists txt_box_file_id text;
alter table public.transcription_nightly_files add column if not exists txt_error text;
alter table public.transcription_nightly_files add column if not exists created_at timestamptz not null default now();
alter table public.transcription_nightly_files add column if not exists updated_at timestamptz not null default now();
create unique index if not exists transcription_nightly_files_box_file on public.transcription_nightly_files(box_file_id);
create index if not exists transcription_nightly_files_run on public.transcription_nightly_files(run_date, status);

alter table public.transcription_nightly_runs enable row level security;
alter table public.transcription_nightly_folders enable row level security;
alter table public.transcription_nightly_files enable row level security;

notify pgrst, 'reload schema';
