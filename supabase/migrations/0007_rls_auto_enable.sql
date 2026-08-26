-- Auto-enable RLS on any new table in `public`.
--
-- CAPTURED FROM PRODUCTION, not newly designed. This function and its event trigger
-- already existed on the Tokyo project but were in no migration file — so they lived only
-- in that one database. The Sydney migration surfaced the drift: a clean rebuild from
-- 0001-0006 produced a database without them, which would have silently dropped a
-- security control on the way across.
--
-- What it does: after any CREATE TABLE in `public`, enable row level security on it.
-- Without RLS a Supabase table is readable by anyone holding the anon key, which ships in
-- the browser bundle — so a table created without it is exposed the moment it exists. This
-- makes the safe state the default rather than something to remember.
--
-- It only enables RLS; it never writes policies. A table with RLS and no policy is
-- readable by nobody, which is the right way round to fail.
--
-- IDEMPOTENT: safe to run repeatedly, and a no-op on the project it came from.

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null
       and cmd.schema_name in ('public')
       and cmd.schema_name not in ('pg_catalog', 'information_schema')
       and cmd.schema_name not like 'pg_toast%'
       and cmd.schema_name not like 'pg_temp%'
    then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        -- Never let this abort the DDL that triggered it. A migration failing because the
        -- safety net stumbled would be worse than the missing net.
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skip % (system schema, or not in the enforced list: %)',
        cmd.object_identity, cmd.schema_name;
    end if;
  end loop;
end;
$$;

-- drop-then-create: CREATE EVENT TRIGGER has no IF NOT EXISTS.
drop event trigger if exists ensure_rls;
create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();
