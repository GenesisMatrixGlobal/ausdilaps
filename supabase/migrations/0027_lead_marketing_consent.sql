-- Marketing consent on a lead.
--
-- The samples gate asks for a name and an email to open the library. Those addresses are a
-- warm list, and Rhys wants to be able to use them — but consent to open a library is not
-- consent to be marketed to, and the Spam Act wants the permission recorded, not assumed.
-- So the form now carries one checkbox, TICKED by default (Rhys, 2026-09-30), and this
-- column is what it writes.
--
-- ⚠️ THREE STATES, and the null is the important one:
--     true   they left the box ticked — usable for marketing
--     false  they deliberately unticked it — DO NOT market to them
--     null   the row predates this column, or came through a form that never asked
--            (/api/quote). Not a yes. Treat it as "never asked" and leave them out of a
--            campaign unless someone decides otherwise for that source.
--   Defaulting this column to true would have overwritten that distinction on every
--   historical row, which is exactly the record you would want in an audit.
--
-- The quote form does NOT write it: someone asking for a quote is starting a conversation
-- they began themselves, and a marketing tickbox on a quote request is a different decision
-- from this one.
--
-- IDEMPOTENT: safe to run repeatedly.
-- After applying: `notify pgrst, 'reload schema';` or PostgREST keeps its cached schema.

alter table public.leads
  add column if not exists marketing_consent boolean;

comment on column public.leads.marketing_consent is
  'True = consented to marketing at capture. False = explicitly declined. Null = never asked (pre-2026-09-30 rows, and every /api/quote lead).';

-- The list this exists to produce: consenting samples-unlock contacts, newest first.
create index if not exists leads_marketing_consent_idx
  on public.leads(created_at desc)
  where marketing_consent = true;

notify pgrst, 'reload schema';
