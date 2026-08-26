-- Knowledge base — the corpus behind the department search bar.
--
-- Three tables, three jobs:
--   knowledge_sources  one row per document, video, note or training module. What a human
--                      uploaded and tagged.
--   knowledge_chunks   the SEARCH UNIT. A 90-minute induction video is a useless result;
--                      "14:22 — ring the subject lot first" is the product. Every chunk
--                      therefore carries enough to deep-link back: an anchor for prose, a
--                      start_seconds for transcripts.
--   knowledge_queries  what people asked. The unanswered ones are the content backlog.
--
-- Reads are department-scoped by RLS, not by application code. Retrieval runs on the
-- user-scoped client (lib/supabase/server.ts), so a bug in the app's department filter
-- cannot leak Accounts content into an Inspector's answer — the database refuses first.
-- Writes go through the service-role client, per the design note at the top of 0001.
--
-- Depends on 0005 for public.has_department() / public.is_internal() / public.profiles,
-- and on 0001 for public.set_updated_at().
-- IDEMPOTENT: safe to run repeatedly.

-- ── Enums ──────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'knowledge_kind') then
    create type knowledge_kind as enum ('document', 'video', 'training', 'note');
  end if;
end $$;

-- ── knowledge_sources ──────────────────────────────────────────────────
create table if not exists public.knowledge_sources (
  id            uuid primary key default gen_random_uuid(),
  kind          knowledge_kind not null,

  -- An empty array means COMPANY-WIDE, and is the whole reason this is an array rather
  -- than a single column: an induction video belongs to Estimators AND Inspectors, and a
  -- leave policy belongs to everyone. Duplicating a document into five departments to
  -- express that is how a knowledge base rots.
  --
  -- Values are lib/departments.ts slugs. No foreign key — departments live in code, same
  -- as tender_sources.slug and tool_usage.tool_slug.
  departments   text[] not null default '{}',

  title         text not null,
  summary       text,

  -- Video/external link. For kind='video' this is what the citation opens, with the
  -- chunk's start_seconds appended.
  url           text,

  -- Original file in the private `knowledge` storage bucket. Kept so staff can be handed
  -- the actual document, and so a re-index doesn't need a re-upload.
  storage_path  text,

  -- For kind='training': the content/training/<dept>/<slug>.mdx this was indexed from.
  -- Lets scripts/index-training.mjs re-index idempotently instead of duplicating.
  source_ref    text,

  is_published  boolean not null default false,

  -- Indexing state. indexed_at null + index_error null = still working.
  indexed_at    timestamptz,
  index_error   text,
  chunk_count   int not null default 0,

  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One row per training file, so re-running the indexer updates rather than duplicates.
create unique index if not exists knowledge_sources_ref_idx
  on public.knowledge_sources(source_ref) where source_ref is not null;

create index if not exists knowledge_sources_dept_idx
  on public.knowledge_sources using gin(departments);

drop trigger if exists trg_knowledge_source_updated on public.knowledge_sources;
create trigger trg_knowledge_source_updated before update on public.knowledge_sources
  for each row execute function public.set_updated_at();

-- ── knowledge_chunks ───────────────────────────────────────────────────
create table if not exists public.knowledge_chunks (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references public.knowledge_sources(id) on delete cascade,

  -- Denormalised from the source so RLS and the search both hit ONE table. Kept in step
  -- by trg_knowledge_chunk_departments below — never write it by hand.
  departments   text[] not null default '{}',

  ordinal       int not null,
  heading       text,
  content       text not null,

  -- Exactly one of these is set, and which one is set is what makes the citation useful.
  start_seconds int,   -- transcripts: the second the answer is spoken
  anchor        text,  -- prose: the heading slug to jump to

  -- Generated, so it can never drift from content the way a trigger-maintained column
  -- can. The 'english' literal is what keeps to_tsvector immutable enough to be stored.
  --
  -- Heading is included and repeated: a chunk under "Step 2 — Check the neighbours"
  -- should rank for "neighbours" even when the body never repeats the word.
  fts tsvector generated always as (
    to_tsvector('english', coalesce(heading, '') || ' ' || coalesce(heading, '') || ' ' || content)
  ) stored,

  created_at    timestamptz not null default now()
);

-- NOTE for Phase 4 (semantic search). Deliberately NOT added yet — full-text over a
-- department-scoped corpus of a few hundred chunks is genuinely good, and embeddings mean
-- a second AI vendor, a new key and a per-chunk cost. When the corpus passes ~1,500 chunks
-- or knowledge_queries shows a tail of should-have-matched misses, the whole migration is:
--
--   create extension if not exists vector with schema extensions;
--   alter table public.knowledge_chunks add column embedding extensions.vector(1536);
--   create index on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);
--
-- then backfill from content. No redesign, no re-upload. `vector` 0.8.0 is available on
-- this project already.

create index if not exists knowledge_chunks_fts_idx
  on public.knowledge_chunks using gin(fts);
create index if not exists knowledge_chunks_dept_idx
  on public.knowledge_chunks using gin(departments);
create unique index if not exists knowledge_chunks_source_ordinal_idx
  on public.knowledge_chunks(source_id, ordinal);

-- Chunks inherit their source's departments. Re-tagging a source in /admin/knowledge has
-- to re-scope its chunks in the same breath, or RLS keeps enforcing yesterday's answer.
create or replace function public.sync_chunk_departments()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'knowledge_chunks' then
    select s.departments into new.departments
    from public.knowledge_sources s where s.id = new.source_id;
    new.departments := coalesce(new.departments, '{}');
    return new;
  else
    if new.departments is distinct from old.departments then
      update public.knowledge_chunks set departments = new.departments where source_id = new.id;
    end if;
    return new;
  end if;
end $$;

drop trigger if exists trg_knowledge_chunk_departments on public.knowledge_chunks;
create trigger trg_knowledge_chunk_departments before insert on public.knowledge_chunks
  for each row execute function public.sync_chunk_departments();

drop trigger if exists trg_knowledge_source_retag on public.knowledge_sources;
create trigger trg_knowledge_source_retag after update on public.knowledge_sources
  for each row execute function public.sync_chunk_departments();

-- ── knowledge_queries ──────────────────────────────────────────────────
-- DELIBERATELY NO USER ID — same call as tool_usage (0008). The signal worth having is
-- "what gets asked that we have no answer for"; that becomes the content backlog. Who
-- asked it adds nothing and is a conversation nobody wants to have later.
create table if not exists public.knowledge_queries (
  id           uuid primary key default gen_random_uuid(),
  query        text not null,
  department   text,               -- null = searched everything they could access
  result_count int not null default 0,
  answered     boolean not null default false,
  asked_at     timestamptz not null default now()
);

create index if not exists knowledge_queries_asked_idx
  on public.knowledge_queries(asked_at desc);
-- The /admin panel's only question: what came up empty, most recent first.
create index if not exists knowledge_queries_unanswered_idx
  on public.knowledge_queries(asked_at desc) where not answered;

-- ── Row Level Security ─────────────────────────────────────────────────
alter table public.knowledge_sources enable row level security;
alter table public.knowledge_chunks  enable row level security;
alter table public.knowledge_queries enable row level security;

-- is_staff(): active staff, admin or superadmin.
--
-- NOT is_internal() — that helper is admin/superadmin ONLY (see the note at the foot of
-- 0005: "Ordinary 'staff' must NOT inherit read access to leads or the dormant portal
-- tables"). Using it here made the knowledge base invisible to every ordinary staff
-- member, which reads on screen as "nothing uploaded yet" rather than as a permissions
-- bug. The whole point of this table is that ordinary staff can search it.
--
-- has_department() covers the department case on its own (it checks is_active and grants
-- admins everything); is_staff() is what gates the company-wide case, where there is no
-- department to check.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (
      select p.is_active and p.role in ('staff', 'admin', 'superadmin')
      from public.profiles p
      where p.id = auth.uid()
    ),
    false
  );
$$;

drop policy if exists "knowledge sources readable by department" on public.knowledge_sources;
create policy "knowledge sources readable by department" on public.knowledge_sources for select
  using (
    public.is_staff()
    and is_published
    and (
      cardinality(departments) = 0
      or exists (select 1 from unnest(departments) d where public.has_department(d))
    )
  );

drop policy if exists "knowledge chunks readable by department" on public.knowledge_chunks;
create policy "knowledge chunks readable by department" on public.knowledge_chunks for select
  using (
    public.is_staff()
    and (
      cardinality(departments) = 0
      or exists (select 1 from unnest(departments) d where public.has_department(d))
    )
    -- An unpublished source must not answer questions. Checked here rather than trusted
    -- to the join, because retrieval selects straight from chunks.
    and exists (
      select 1 from public.knowledge_sources s
      where s.id = source_id and s.is_published
    )
  );

-- Stays is_internal() (admin-only) on purpose: this is the /admin content-backlog panel,
-- and the list of questions colleagues asked is not something all staff need to browse.
drop policy if exists "knowledge queries internal read" on public.knowledge_queries;
create policy "knowledge queries internal read" on public.knowledge_queries for select
  using (public.is_internal());

-- ── Storage ────────────────────────────────────────────────────────────
-- Private bucket for the original uploads. NO policies on storage.objects by design:
-- every read is a signed URL minted server-side after an explicit access check, and every
-- write goes through the service-role client. A bucket with no policy is a bucket that
-- cannot be reached with an anon key.
insert into storage.buckets (id, name, public)
values ('knowledge', 'knowledge', false)
on conflict (id) do nothing;

-- ── Who may upload ─────────────────────────────────────────────────────
-- Uploading training material is NOT an admin-only job: department leads curate their own
-- team's content. But it isn't open to all staff either — published content answers
-- questions on their colleagues' behalf.
--
-- One boolean, scoped by the departments already on the profile. That composes for free:
--   admin / superadmin   → anything, including company-wide
--   flagged staff        → only content tagged to departments they belong to
--   everyone else        → read only
--
-- Company-wide content (departments = '{}') stays admin-only on purpose: a single
-- estimator should not be able to publish something that answers for the whole company.
alter table public.profiles
  add column if not exists can_manage_knowledge boolean not null default false;

comment on column public.profiles.can_manage_knowledge is
  'May add/edit knowledge sources for their own departments. Admins bypass this.';

create or replace function public.can_edit_knowledge(dept_list text[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (
      select
        p.is_active and (
          p.role in ('superadmin', 'admin')
          or (
            p.can_manage_knowledge
            -- Non-empty, and every department on the content is one of theirs. "Every",
            -- not "any": otherwise tagging {estimators, inspectors} would let an
            -- estimator publish into Inspectors by including their own team in the list.
            and cardinality(dept_list) > 0
            and not exists (
              select 1 from unnest(dept_list) d where d <> all(p.departments)
            )
          )
        )
      from public.profiles p
      where p.id = auth.uid()
    ),
    false
  );
$$;

-- Carry the flag through an invite, the way 0005 carries role and departments. Without
-- this, a staff member invited as a contributor lands with the flag false and needs a
-- second edit.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta_role text := nullif(new.raw_user_meta_data->>'role', '');
  new_role  user_role;
begin
  new_role := case
    when meta_role in ('superadmin', 'admin', 'staff') then meta_role::user_role
    else 'client_member'::user_role
  end;

  insert into public.profiles (id, email, full_name, role, departments, invited_by, can_manage_knowledge)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data->>'full_name', ''),
    new_role,
    case
      when jsonb_typeof(new.raw_user_meta_data->'departments') = 'array'
        then array(select jsonb_array_elements_text(new.raw_user_meta_data->'departments'))
      else '{}'::text[]
    end,
    (new.raw_user_meta_data->>'invited_by')::uuid,
    coalesce((new.raw_user_meta_data->>'can_manage_knowledge')::boolean, false)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
