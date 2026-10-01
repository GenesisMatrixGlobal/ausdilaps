-- Tender Watch -> Salesforce handoff codes.
--
-- APPLIED to Sydney (crqfxdywgxtxgpwrojyc) 2026-10-01, via the SQL editor in the Browser
-- pane — the Management API token is still expired. Verified afterwards through PostgREST:
-- the table is reachable, every column handoff-store writes accepts a value, and the unique
-- index on group_key rejects a second row for the same opportunity (which is what makes
-- allocation idempotent).
--
-- A staff member reads the handoff email, opens the "New Opportunity + TenderWatch" screen
-- flow and types one short code. The flow looks that code up in Salesforce and pre-fills
-- everything we already know, leaving them the judgement fields (value range, priority,
-- owner, contact). This table is OUR half of that: it allocates the code and keeps what was
-- sent under it.
--
-- ── Why a SNAPSHOT, and why not a column on tender_items ─────────────────────────────────
--
-- A code identifies an OPPORTUNITY, and an opportunity here is a GROUP of rows — the same
-- tender reaches us up to five times and group.ts collapses them at READ time, deliberately
-- (see lib/tenders/group.ts: a wrong storage-level key discards a real tender with no trace).
-- So there is no single row to hang the code on.
--
-- It also has to keep working later. The record may be raised days after the email, by which
-- time re-deriving the group could pick up a sixth copy, or the member rows could have aged
-- past the review window. Resolving the code must not depend on any of that, so the fields
-- are stored AS SENT rather than re-read.

create table if not exists public.tender_handoffs (
  id              uuid primary key default gen_random_uuid(),

  -- `TW-4F7K2`. Short enough to read over the phone, and from an alphabet with no 0/O/1/I/5/S.
  code            text        not null unique,

  -- group.ts's key for the opportunity. UNIQUE, so sending the same job twice — a preview to
  -- yourself and then the real send, or a re-send after a correction — reuses one code rather
  -- than minting a second for the same work.
  group_key       text        not null unique,

  -- Every member row the code covers, for tracing back to what arrived.
  item_ids        uuid[]      not null default '{}',

  -- ── The snapshot the flow pre-fills from ──
  project_name    text        not null,
  site_street     text,
  site_city       text,
  site_state      text,
  site_postcode   text,
  client_name     text,
  contact_name    text,
  contact_email   text,
  closes_at       timestamptz,
  portal_url      text,
  -- The tender's own reference (TS #967459, vic:334821) -> Opportunity.Portal_Ref_no__c,
  -- which is what makes "have we already raised this one?" answerable in Salesforce itself.
  portal_ref      text,
  source_label    text,
  summary         text,

  created_at      timestamptz not null default now(),
  created_by      uuid        references auth.users (id) on delete set null,

  -- Set once the row has been pushed to Salesforce as a Tender_Watch_Item__c. Null means the
  -- push has not happened or failed; sf_error says which. Never throws on the send path — a
  -- Salesforce outage must not stop the handoff email going out.
  salesforce_id   text,
  sf_synced_at    timestamptz,
  sf_error        text
);

create index if not exists tender_handoffs_created_idx on public.tender_handoffs (created_at desc);
-- Partial: the retry sweep only ever wants the ones that have not landed.
create index if not exists tender_handoffs_unsynced_idx on public.tender_handoffs (created_at)
  where salesforce_id is null;

alter table public.tender_handoffs enable row level security;

-- Staff read; only the service role writes (the send route). Mirrors tender_items.
drop policy if exists "staff read tender handoffs" on public.tender_handoffs;
create policy "staff read tender handoffs"
  on public.tender_handoffs for select
  to authenticated
  using (public.is_staff());

-- ⚠️ PostgREST caches the schema. Without this the new table reads as
-- "Could not find the table in the schema cache" however correct the SQL was.
notify pgrst, 'reload schema';
