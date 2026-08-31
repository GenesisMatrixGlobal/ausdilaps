-- Tender sources discovered from sender domains, instead of hand-listed in code.
--
-- 0006 seeded three email sources by name — buy.nsw, QTenders, direct invitations — and
-- adding a fourth portal meant editing a table in lib/tenders/senders.ts. That is backwards:
-- portals get signed up for ad hoc, and the mailbox already knows exactly who is emailing
-- it. The domain IS the source, and a new one starts being tracked the night its first
-- email lands.
--
-- Two columns here exist to stop that becoming worse than what it replaces:
--
--   alert_on_quiet  Every direct client invitation is also a domain. summary.ts marks any
--                   source 'critical' after 5 empty runs, so auto-creating a row per
--                   domain with alarms on would paint the dashboard red inside a month —
--                   fifty one-off clients all critical, and the alarm that exists to catch
--                   buy.nsw dropping us becomes noise nobody reads. Defaults FALSE; an
--                   operator turns it on for the handful that are real portals.
--
--   parse_mode      'auto' decides digest-vs-single per message, biased toward digest,
--                   because the two mistakes are not symmetrical: a 30-tender digest read
--                   as one email loses 29 silently, while a single read as a digest just
--                   produces a couple of junk items the classifier rejects.
--
-- Depends on 0006. IDEMPOTENT: safe to run repeatedly.

alter table public.tender_sources
  add column if not exists auto_discovered boolean not null default false,
  add column if not exists alert_on_quiet  boolean not null default false,
  -- Sender trust was a hardcoded domain list. It is per-source state, so it lives on the
  -- row: new domains start untrusted, get badged "unverified sender", and stay out of the
  -- digest until TENDER_FORWARD_UNTRUSTED says otherwise. TENDER_TRUSTED_SENDER_DOMAINS
  -- survives only as a seed applied at discovery.
  add column if not exists is_trusted      boolean not null default false,
  add column if not exists parse_mode      text not null default 'auto',
  -- Redundant with the slug ('email:<domain>') and worth it: every query and every bit of
  -- UI that wants the domain would otherwise be slicing a prefix off a primary key.
  add column if not exists sender_domain   text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tender_sources_parse_mode_check') then
    alter table public.tender_sources add constraint tender_sources_parse_mode_check
      check (parse_mode in ('auto', 'digest', 'single'));
  end if;
end $$;

create index if not exists tender_sources_domain_idx
  on public.tender_sources(sender_domain) where sender_domain is not null;

comment on column public.tender_sources.alert_on_quiet is
  'Opt in to the gone-quiet alarm. Off by default so one-off senders do not drown the real portals.';
comment on column public.tender_sources.parse_mode is
  'auto | digest | single. auto leans digest: losing 29 of 30 tenders is silent, junk items are not.';

-- The three hand-seeded email rows from 0006 are superseded by discovery.
--
-- Safe because nothing references them: tender_items and tender_scan_runs are both empty
-- (Tender Watch has never run). Guarded anyway rather than trusted — if a row somehow has
-- history, keep it and let discovery add the domain-keyed one alongside.
delete from public.tender_sources s
 where s.kind = 'email'
   and s.slug in ('buynsw-digest', 'qtenders-alert', 'direct-invite')
   and not exists (select 1 from public.tender_items    i where i.source_slug = s.slug)
   and not exists (select 1 from public.tender_scan_runs r where r.source_slug = s.slug);
