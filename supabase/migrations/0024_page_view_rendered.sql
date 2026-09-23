-- Did the samples page actually get DRAWN on a screen, or was it only fetched?
--
-- The view counter runs in proxy.ts, at request time, and its only evidence is the request
-- headers. That was already tightened once (0015's note: `sec-fetch-dest` must be present
-- and "document"), and it still cannot see the thing that matters — whether a human ever
-- looked at the page.
--
-- Measured on 2026-09-23, 26 "visitors" over nine days: five unlocked and six opened a file,
-- and about twenty were a single view, zero seconds on site, no referrer, never unlocked,
-- each on a different browser version scattered across Chrome 86 / 100 / 100 / 116 / 123 and
-- three separate desktop Linux machines. The decisive evidence was in web_vitals: four page
-- loads landing inside FORTY MILLISECONDS of each other —
--
--     16:14:23.812 / .843 / .858 / .862   ttfb 14, 16, 15, 15 ms
--
-- repeating on five separate days, every one of them recording no paint at all. No person
-- opens a page four times in a twentieth of a second, and a 14ms response is a datacentre
-- next to Vercel rather than a home connection. These are headless browsers announcing
-- themselves as desktop Chrome, so they pass the user-agent regex AND send `sec-fetch-dest`.
-- No amount of header sniffing catches them.
--
-- A PAINT does. `rendered` is set by a beacon the page fires only once the browser reports a
-- First Contentful Paint — proof that pixels reached a screen, which is exactly the thing a
-- fetch-and-discard client cannot fake without actually rendering.
--
-- DEFAULT FALSE, and the row is still written. An unrendered view is a real request and
-- worth keeping: it is how the scraping is measured. The READERS count rendered views and
-- report the rest separately, so nothing is hidden, it is just no longer called a visitor.
--
-- ⚠️ Rows created before this migration have `rendered = false` and were never given the
-- chance to say otherwise. /admin reports anything older than the first rendered row as
-- "not measured", never as automated.
--
-- IDEMPOTENT: safe to run repeatedly.
-- After applying: `notify pgrst, 'reload schema';` or PostgREST keeps its cached schema.

alter table public.page_views
  add column if not exists rendered boolean not null default false;

comment on column public.page_views.rendered is
  'The browser reported a First Contentful Paint for this view. False = fetched but never drawn (or predates migration 0024).';

-- The reader asks for "rendered views in the last N days" on every dashboard load.
create index if not exists page_views_rendered_idx
  on public.page_views(path, occurred_at desc)
  where rendered = true;

-- Finding the row to confirm: newest view for one visitor.
create index if not exists page_views_visitor_time_idx
  on public.page_views(visitor_id, occurred_at desc);

notify pgrst, 'reload schema';
