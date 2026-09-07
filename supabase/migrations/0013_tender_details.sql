-- 0013 — the fields the handoff email actually needs
--
-- The handoff email is meant to be the whole job: read it, create the Salesforce record,
-- done. It could not be, because three of the five things someone needs were not stored
-- anywhere in the pipeline:
--
--   site_location   Where the work is. Nothing held this. `jurisdiction` is a state code.
--   contact         Who to submit to. `email_from` is provenance (often no-reply@), not a
--                   contact.
--   mailbox_url     See below — this one is a bug fix, not a new feature.
--
-- Both high-volume senders turned out to label all of it already (TenderSearch:
-- "Location: GOONDIWINDI QLD", "Contact: …"; Felix: "Location:", "RFQ Owner:"), so these are
-- populated by deterministic extraction in lib/tenders/sources/extract/ — no model, no cost.
-- Only the handful of free-prose email invitations need the classifier, and it gets the one
-- extra field on a call it was already making.
--
-- ⚠️ Columns go in an explicit `alter table ... add column if not exists`, NEVER inside a
-- `create table if not exists`. On a database that already has the table the create is a
-- no-op and the new columns would never land. This has bitten this project before — see the
-- note in 0009.
--
-- ⚠️ Run `notify pgrst, 'reload schema';` afterwards (it is the last statement here) or
-- PostgREST keeps serving its cached schema and every new column reads as "does not exist".

alter table public.tender_items
  add column if not exists site_location text,
  add column if not exists contact       text,
  add column if not exists mailbox_url   text;

comment on column public.tender_items.site_location is
  'Where the work is, as the notice states it (e.g. "NORTH RICHMOND, NSW"). A display string, not a geocoding input.';
comment on column public.tender_items.contact is
  'Who to submit to. A named person where the source gives one (Felix "RFQ Owner"), otherwise the buying body.';
comment on column public.tender_items.mailbox_url is
  'Graph webLink into tenders@ — a link only WE can open. Deliberately NOT url, which must only ever hold a link the recipient of a handoff email can follow.';

-- ── Why mailbox_url exists ────────────────────────────────────────────────────────────────
--
-- singleItem() set `url = message.webLink`, which Graph returns as an OWA deep link into the
-- tenders@ mailbox. It is a perfectly valid https URL, so it passed safeExternalUrl() and the
-- handoff email cheerfully offered staff a link into a mailbox they have no access to — on
-- 6 of 41 rows, including the highest-confidence match in the queue.
--
-- Splitting it out makes `url` mean exactly one thing. A direct email invitation now has NO
-- url, which is the truth: there is no portal, and the email says "Invitation by email" and
-- names the sender instead of offering a link that 403s.

-- ── The upsert has to learn the new columns ───────────────────────────────────────────────
--
-- Rewritten in full rather than patched, because the `do update set` list is the
-- highest-consequence code in the whole feature and it should be read as a whole.
create or replace function public.tender_upsert_item(p jsonb)
returns table (id uuid, is_new boolean)
language plpgsql as $$
begin
  return query
  insert into public.tender_items (
    source_slug, external_ref, content_hash, title, agency, jurisdiction,
    url, published_at, closes_at, excerpt,
    site_location, contact, mailbox_url,
    email_message_id, email_from, auth_results, sender_trusted,
    first_seen_run_id, last_seen_run_id
  )
  select
    p->>'source_slug', p->>'external_ref', nullif(p->>'content_hash', ''),
    p->>'title', nullif(p->>'agency', ''), nullif(p->>'jurisdiction', ''),
    nullif(p->>'url', ''),
    nullif(p->>'published_at', '')::timestamptz,
    nullif(p->>'closes_at', '')::timestamptz,
    nullif(p->>'excerpt', ''),
    nullif(p->>'site_location', ''), nullif(p->>'contact', ''), nullif(p->>'mailbox_url', ''),
    nullif(p->>'email_message_id', ''), nullif(p->>'email_from', ''),
    nullif(p->>'auth_results', ''),
    coalesce((p->>'sender_trusted')::boolean, false),
    nullif(p->>'run_id', '')::uuid, nullif(p->>'run_id', '')::uuid
  on conflict (source_slug, external_ref) do update set
    -- Refresh ONLY what the source owns. Never relevance / model_* / forwarded_at /
    -- status / classify_attempts. A careless `do update set` here re-classifies and
    -- re-emails the entire back-catalogue to the team every single night — it is the
    -- highest-consequence line in this migration.
    title            = excluded.title,
    agency           = coalesce(excluded.agency, public.tender_items.agency),
    jurisdiction     = coalesce(excluded.jurisdiction, public.tender_items.jurisdiction),
    closes_at        = coalesce(excluded.closes_at, public.tender_items.closes_at),
    url              = coalesce(excluded.url, public.tender_items.url),
    excerpt          = coalesce(excluded.excerpt, public.tender_items.excerpt),
    -- coalesce, so a reminder that omits a field cannot blank what the original notice
    -- gave us. Felix's "last chance" email carries no location; the first one did.
    site_location    = coalesce(excluded.site_location, public.tender_items.site_location),
    contact          = coalesce(excluded.contact, public.tender_items.contact),
    mailbox_url      = coalesce(excluded.mailbox_url, public.tender_items.mailbox_url),
    last_seen_run_id = excluded.last_seen_run_id,
    updated_at       = now()
  -- xmax = 0 distinguishes an insert from an update, which is what makes items_new an
  -- honest counter. supabase-js `.upsert()` cannot report it.
  returning public.tender_items.id, (xmax = 0) as is_new;
end;
$$;

revoke all on function public.tender_upsert_item(jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
