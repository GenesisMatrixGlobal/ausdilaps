-- Web Vitals — what the site actually felt like for real visitors.
--
-- The /admin "Site health" panel already shows Lighthouse scores from the PageSpeed API.
-- Those are LAB numbers: one synthetic run, on Google's hardware, on a simulated slow
-- connection. They answer "is the page built well". They cannot answer "is it fast for the
-- people using it", which depends on real devices and real Australian connections. This
-- table is the field half of that pair.
--
-- ONE ROW PER PAGE VIEW, not one per metric. The five Core Web Vitals arrive at different
-- moments (FCP/TTFB/LCP during load, CLS as the page settles, INP on the first real
-- interaction), so the client accumulates them and posts once when the page is hidden.
-- Five rows per view would multiply the write volume by five and make every query a pivot.
--
-- DELIBERATELY NO USER, NO IP, NO SESSION. Same stance as tool_usage and page_views: the
-- question is "how fast is the site", not "who was on it". There is nothing here to join
-- back to a person, which is what makes it safe to collect from an unauthenticated route.
--
-- Metrics are NULLABLE on purpose. A visitor who reads a page and leaves without clicking
-- produces no INP; one who navigates away mid-load produces no LCP. Storing the partial row
-- is right — throwing it away would bias the sample towards long, interactive visits, which
-- are exactly the ones least likely to be slow.
--
-- IDEMPOTENT: safe to run repeatedly.
-- After applying: `notify pgrst, 'reload schema';` or PostgREST keeps its cached schema.

create table if not exists public.web_vitals (
  id          uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  /** Pathname only — never the query string, which can carry an access code. */
  path        text not null,
  /** 'mobile' or 'desktop', decided by viewport width at load. */
  device      text not null,
  /** Largest Contentful Paint, ms. Google's "good" threshold is 2500. */
  lcp_ms      integer,
  /** Interaction to Next Paint, ms. "good" is 200. Null when nobody interacted. */
  inp_ms      integer,
  /** Cumulative Layout Shift, unitless 0..n. "good" is 0.1. */
  cls         numeric(7, 4),
  /** First Contentful Paint, ms. */
  fcp_ms      integer,
  /** Time to First Byte, ms — the server's share of the delay. */
  ttfb_ms     integer
);

create index if not exists web_vitals_time_idx      on public.web_vitals(occurred_at desc);
create index if not exists web_vitals_path_time_idx on public.web_vitals(path, occurred_at desc);

-- ── Row Level Security ──────────────────────────────────────────────────
alter table public.web_vitals enable row level security;

-- Internal read only, writes via the service-role client — same as tool_usage and
-- page_views. Nothing anonymous may read this back, even though anonymous visitors are
-- what fills it.
drop policy if exists "web vitals internal read" on public.web_vitals;
create policy "web vitals internal read" on public.web_vitals for select
  using (public.is_internal());

notify pgrst, 'reload schema';
