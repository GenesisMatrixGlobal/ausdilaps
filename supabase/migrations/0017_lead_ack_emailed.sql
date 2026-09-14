-- Split the two emails a quote submission sends.
--
-- /api/quote sends TWO different messages and, until now, recorded one boolean for both:
-- `emailed = adminSent && ackSent`. Those are not the same question and they do not have
-- the same consequence.
--
--   * The notice to info@ausdilaps.com.au is the one that MATTERS. If it fails, a real
--     enquiry sits in the database and nobody in the business knows it exists.
--   * The acknowledgement to the enquirer is a courtesy. If it fails — a typo'd address, a
--     full mailbox, a domain that rejects us — the enquiry is still perfectly safe.
--
-- Conflating them meant a bounced courtesy email raised "nobody was notified about this
-- enquiry" on the dashboard when info@ had in fact been told. An alarm that cries wolf
-- about the one thing you must not ignore is worse than no alarm.
--
-- So from here: `emailed` means ONLY "the info@ notice was accepted for delivery", and
-- `ack_emailed` carries the courtesy email. NULL on both means the send was never attempted
-- or predates this split — it is not a failure, and the UI must not draw it as one.
--
-- ⚠️ "Accepted by Resend" is not "landed in the inbox". A later bounce is invisible here.
-- Treat a tick as "we handed it over successfully", not as proof it was read.
--
-- IDEMPOTENT: safe to run repeatedly.
-- After applying: `notify pgrst, 'reload schema';` or PostgREST keeps its cached schema.

alter table public.leads
  add column if not exists ack_emailed boolean;

comment on column public.leads.emailed is
  'The notification to info@ (ADMIN_EMAIL) was accepted by Resend. The one that matters.';
comment on column public.leads.ack_emailed is
  'The courtesy acknowledgement to the enquirer was accepted by Resend. Null = not attempted.';

-- Finding the enquiries nobody was told about is the dashboard's alert query, so it gets
-- an index rather than a scan. Partial: the interesting rows are the rare ones.
create index if not exists leads_not_notified_idx
  on public.leads(created_at desc)
  where emailed = false;

notify pgrst, 'reload schema';
