-- 0030: PageSpeed lab scores, written by a nightly cron and only READ by /admin.
--
-- The Command Centre's "Site health" panel shows Google's Lighthouse scores for the homepage
-- and the quote form. A Lighthouse run takes 10-40 seconds, so it must never happen while
-- someone waits for the page. It used to be cached with unstable_cache for 24 hours, and that
-- broke in two verified ways:
--
--   1. unstable_cache keys on the callback's SOURCE TEXT, and production ships it minified —
--      so a deploy that shifts the mangled names resets the "24h" cache, and the first open
--      after it ran two live Lighthouse calls (10-40s) in front of the GM.
--   2. Since the scores moved into their own Suspense boundary (80bb943), the background
--      refresh and the miss-path cache write register AFTER Next has taken its one snapshot
--      of pending revalidations, and RSC navigations never pass waitUntil — so a refresh
--      could be cut off and the next open measured live all over again.
--
-- A cron route cannot share that cache entry (a different bundle mangles the callback
-- differently, so the key differs), so the cache is gone: /api/pagespeed measures every page
-- at 2am Brisbane and upserts here, and the dashboard reads two rows.
--
-- ONE ROW PER PAGE, keyed on the path. A failed run keeps the last GOOD scores: the cron
-- writes only label, error and checked_at on a failure, so measured_at says how old the
-- scores are and error says why the latest check didn't replace them.
--
--   measured_at  the last SUCCESSFUL measurement
--   error        the last failure, set back to null by the next success
--   checked_at   the last attempt, success or failure
--
-- RLS on with NO policies: only the service role reads or writes (the cron route and the
-- admin dashboard, which checks the admin role itself). Lab scores are not secret, but nothing
-- anonymous has any reason to read them.
--
-- IDEMPOTENT: safe to run repeatedly. Columns are in the create AND in an explicit
-- add-column-if-not-exists, so a table from a partial earlier paste still gets them.

create table if not exists public.pagespeed_scores (
  path            text primary key,
  label           text not null,
  performance     smallint,
  accessibility   smallint,
  seo             smallint,
  best_practices  smallint,
  measured_at     timestamptz,
  error           text,
  checked_at      timestamptz not null default now()
);
-- `path` is the primary key, so a table without it is not this table and there is nothing to
-- repair. `label` carries a default here ONLY so the add succeeds on a table that already has
-- rows; the cron rewrites it on every run, and the create above (the normal path) has none.
alter table public.pagespeed_scores add column if not exists label text not null default '';
alter table public.pagespeed_scores add column if not exists performance smallint;
alter table public.pagespeed_scores add column if not exists accessibility smallint;
alter table public.pagespeed_scores add column if not exists seo smallint;
alter table public.pagespeed_scores add column if not exists best_practices smallint;
alter table public.pagespeed_scores add column if not exists measured_at timestamptz;
alter table public.pagespeed_scores add column if not exists error text;
alter table public.pagespeed_scores add column if not exists checked_at timestamptz not null default now();

alter table public.pagespeed_scores enable row level security;

notify pgrst, 'reload schema';
