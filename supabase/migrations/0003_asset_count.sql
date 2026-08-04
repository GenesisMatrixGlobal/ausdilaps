-- Adds "Approx. assets requiring inspection" (New Quote branch) to leads,
-- replacing the old free-numeric adjoining_count with a bucketed range.
-- IDEMPOTENT: safe to run repeatedly.

alter table public.leads add column if not exists asset_count text;

create index if not exists leads_asset_count_idx on public.leads(asset_count);
