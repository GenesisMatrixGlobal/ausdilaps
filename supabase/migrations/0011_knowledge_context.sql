-- 0011 — Uploader context + AI-generated index signal.
--
-- The problem this solves, in the words of a real row: the one uploaded document in
-- the base indexes as "Wednesday, August 23, 2023 / Click 'Edit' from the right hand
-- side menu". That will never match "how do I stop a client editing a survey". The
-- procedure is in the document; the reason you would reach for it exists only in the
-- uploader's head, and the screenshots that carry half the instruction are not
-- indexed at all.
--
-- So we capture three things from the uploader and fuse them with the document into
-- an AI summary + keyword list.
--
-- WHERE THIS LANDS IS THE WHOLE DESIGN. All of it is SOURCE-level. None of it goes
-- into knowledge_chunks, ever:
--
--   * A chunk is what gets CITED. Push context into every chunk and all of them match
--     equally, which destroys the ranking that picks the passage actually answering
--     the question — and pollutes every snippet with text the document never said.
--   * A summary is an interpretation. It must never be quotable as if it were the
--     document. A vision RENDERING is a transcription, so that one legitimately
--     becomes `body` and is chunked.
--
-- search_knowledge() (0010) already matches `c.fts @@ q OR s.fts @@ q`, so widening
-- the source vector below is the entire integration. No query changes.

alter table public.knowledge_sources
  -- The three guided prompts. Separate columns rather than one blob so the form can
  -- ask specific questions, which is what makes people write useful context.
  add column if not exists context_covers text,   -- what does this cover?
  add column if not exists context_when   text,   -- when would someone need it?
  add column if not exists context_called text,   -- what do we call it internally?
  -- Generated at index time from body + context + transcript.
  add column if not exists ai_summary text,
  -- Comma-separated, NOT text[]. array_to_string() is STABLE, not IMMUTABLE, so
  -- Postgres refuses it inside the generated column below. The UI splits on commas.
  add column if not exists ai_keywords text,
  -- Set when a person corrects the summary by hand. indexSource() then leaves both
  -- AI fields alone on re-index. Without this the edit feature is decorative: the
  -- next re-index would silently overwrite the correction with the same model output
  -- that was wrong the first time.
  add column if not exists ai_summary_edited boolean not null default false;

comment on column public.knowledge_sources.ai_summary is
  'Model-written. Indexed as a search signal; never cited as document content — see 0011.';

-- ---------------------------------------------------------------------------
-- Re-weight the source vector.
-- ---------------------------------------------------------------------------
-- 0010 wrote the title twice as a crude weighting trick. That does not survive three
-- more fields of wildly different lengths — 300 words of dictated context would
-- drown a six-word title and the document would start matching everything.
--
-- setweight + ts_rank's default weights {A 1.0, B 0.4, C 0.2} give the right shape:
--   A  title            — the strongest statement of what a thing is
--   B  summary,         — deliberate one-liners, human and machine
--      ai_summary
--   C  context,         — rambling, dictated, high-recall, low-precision
--      ai_keywords
--
-- A generated column must be IMMUTABLE all the way down: to_tsvector('english', ...)
-- with a literal config is immutable, setweight and || are immutable, coalesce is
-- immutable. Anything reading a GUC (to_tsvector with a regconfig column, or
-- array_to_string) is not, and the ALTER will fail outright rather than silently.
alter table public.knowledge_sources drop column if exists fts;

alter table public.knowledge_sources
  add column fts tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(
         to_tsvector('english', coalesce(summary, '') || ' ' || coalesce(ai_summary, '')),
         'B'
       )
    || setweight(
         to_tsvector(
           'english',
           coalesce(context_covers, '') || ' ' ||
           coalesce(context_when, '')   || ' ' ||
           coalesce(context_called, '') || ' ' ||
           coalesce(ai_keywords, '')
         ),
         'C'
       )
  ) stored;

create index if not exists knowledge_sources_fts_idx
  on public.knowledge_sources using gin (fts);

-- Dropping the column dropped its index with it; PostgREST also needs telling.
notify pgrst, 'reload schema';
