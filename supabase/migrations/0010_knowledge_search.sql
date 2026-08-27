-- 0010 — Knowledge search (Phase 2, retrieval).
--
-- The corpus has been write-only since 0009: chunks go in, nothing reads them.
-- This adds the read side as Postgres full-text search — no embeddings, no second
-- vendor, no per-query cost. 0009 already built most of it: the stored `fts`
-- tsvector on chunks (heading weighted by repetition) and its GIN index.
--
-- Two things 0009 left that make naive FTS useless on a real question:
--
--   1. The source TITLE is not searchable. chunks.fts covers heading + content
--      only, so the one indexed document — "Producing a residential site markup" —
--      did not match the query "site markup". Fixed below with a generated fts
--      column on knowledge_sources so the title branch stays index-backed.
--
--   2. websearch_to_tsquery ANDs every term, so one unmatched word returns zero
--      rows. "site markup" found nothing because no single chunk contained both
--      "site" and "markup". On a corpus this size, returning nothing is always the
--      wrong answer — see or_query() below.

-- ---------------------------------------------------------------------------
-- 1. Make source titles searchable.
-- ---------------------------------------------------------------------------
-- Title twice, for the same reason 0009 repeats the chunk heading: what a document
-- is called is the strongest single signal about what it answers.
alter table public.knowledge_sources
  add column if not exists fts tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(title, '') || ' ' || coalesce(summary, '')
    )
  ) stored;

create index if not exists knowledge_sources_fts_idx
  on public.knowledge_sources using gin (fts);

-- ---------------------------------------------------------------------------
-- 2. Widen a strict AND query into OR.
-- ---------------------------------------------------------------------------
-- Rewriting the parsed tsquery's & operators as | keeps everything else
-- websearch_to_tsquery built — phrase operators from "quoted text", negation from
-- -word — while letting a partial match through. Ranking still puts chunks that
-- matched every term on top, so widening costs precision nothing; it only changes
-- what happens below the fold, where the alternative was an empty panel.
create or replace function public.or_query(q text)
returns tsquery language sql immutable parallel safe as $$
  select nullif(replace(websearch_to_tsquery('english', q)::text, '&', '|'), '')::tsquery;
$$;

-- ---------------------------------------------------------------------------
-- 3. The search itself.
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER IS LOAD-BEARING. RLS on knowledge_chunks/knowledge_sources is the
-- only thing scoping this corpus to a department. A security definer function would
-- run as the owner and hand every staff member every department's material. Do not
-- "fix" a permissions error here by changing this line.
--
-- Why an RPC at all rather than PostgREST's .textSearch(): ranking. PostgREST can
-- filter on a tsvector but cannot order by ts_rank_cd, and unranked full-text
-- results are barely better than random.
create or replace function public.search_knowledge(
  q text,
  dept text,
  max_results int default 20
)
returns table (
  chunk_id uuid,
  source_id uuid,
  heading text,
  content text,
  snippet text,
  anchor text,
  start_seconds int,
  rank real,
  source_title text,
  source_kind knowledge_kind,
  source_url text,
  source_storage_path text
)
language sql
stable
security invoker
set search_path = public
as $$
  with tq as (select public.or_query(q) as query)
  select
    chunk_id, source_id, heading, content, snippet, anchor, start_seconds,
    rank, source_title, source_kind, source_url, source_storage_path
  from (
    select
      c.id as chunk_id,
      c.source_id,
      c.heading,
      c.content,
      -- Guillemets rather than <mark>: ts_headline does not escape the source text,
      -- so returning HTML would hand an uploaded document a script tag straight into
      -- the results panel. The client splits on these and renders its own <mark>.
      ts_headline(
        'english', c.content, tq.query,
        'StartSel=«, StopSel=», MaxWords=42, MinWords=18, MaxFragments=1, FragmentDelimiter= … '
      ) as snippet,
      c.anchor,
      c.start_seconds,
      -- Chunk body carries the weight; a title match adds a nudge rather than
      -- winning outright, because the answer still has to be in the chunk.
      (ts_rank_cd(c.fts, tq.query) + 0.4 * ts_rank(s.fts, tq.query))::real as rank,
      s.title as source_title,
      s.kind as source_kind,
      s.url as source_url,
      s.storage_path as source_storage_path,
      -- One long video should not be able to fill the whole panel with its own
      -- transcript. Three windows into a source is plenty to judge relevance.
      row_number() over (
        partition by c.source_id
        order by ts_rank_cd(c.fts, tq.query) desc, c.ordinal
      ) as per_source
    from tq, public.knowledge_chunks c
    join public.knowledge_sources s on s.id = c.source_id
    where tq.query is not null
      and (c.fts @@ tq.query or s.fts @@ tq.query)
      -- Scope to the department being searched from, plus company-wide material.
      -- This is NOT redundant with RLS: has_department() (0005) returns true for
      -- admins on every department, so without this an admin searching Estimators
      -- would get Inspectors' material back.
      and (cardinality(c.departments) = 0 or dept = any(c.departments))
  ) ranked
  where per_source <= 3
  order by rank desc, source_title, chunk_id
  limit least(greatest(max_results, 1), 50);
$$;

comment on function public.search_knowledge(text, text, int) is
  'Ranked full-text search over knowledge_chunks. SECURITY INVOKER so RLS scopes the result — see 0010.';

grant execute on function public.or_query(text) to authenticated;
grant execute on function public.search_knowledge(text, text, int) to authenticated;

-- PostgREST caches the schema; without this the RPC reads as "function not found".
notify pgrst, 'reload schema';
