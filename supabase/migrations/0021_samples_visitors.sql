-- 0021: who looked at the samples, and what they opened.
--
-- 0015 kept page_views anonymous on purpose ("the question is volume, not who"). Rhys asked
-- on 2026-09-18 for the opposite: click the "Samples viewed" tile and see the people — when
-- they came, how they got in, which files they opened. Three columns do it:
--
--   visitor_id  a random id set in an httpOnly cookie (`ad_samples_v`) the first time a
--               browser hits the samples page, and sent back on every view and click after.
--               It identifies a BROWSER, not a person. Nothing about the person is derived
--               from it; it only lets the rows from one browser be read as one visit history.
--   lead_id     set on the `unlock_email` row only — the name + email the visitor typed on
--               the locked page. This is the only way a visitor gets a name: the access code
--               is shared across every quote, so a code unlock is anonymous by construction.
--               ON DELETE SET NULL: removing a lead must not remove the fact they visited.
--   item        the file title on a new `click_item` event, written by
--               /dilapidation-reports/samples/click when a row in the library is opened.
--
-- Rows written before this lands have no visitor_id and are reported as one line of
-- "untracked views" on /admin/samples, not dropped. The writer (lib/page-views.ts) retries
-- without the new columns while they are missing, so a deploy landing before this paste
-- records exactly as it did before.
--
-- IDEMPOTENT: safe to run repeatedly.

alter table public.page_views add column if not exists visitor_id text;
alter table public.page_views add column if not exists lead_id    uuid references public.leads(id) on delete set null;
alter table public.page_views add column if not exists item       text;

-- "This browser's history on this page" is the shape /admin/samples groups by.
create index if not exists page_views_visitor_idx
  on public.page_views(path, visitor_id, occurred_at desc)
  where visitor_id is not null;

notify pgrst, 'reload schema';
