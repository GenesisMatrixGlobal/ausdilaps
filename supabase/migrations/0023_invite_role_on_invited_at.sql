-- 0023: 0022 broke every invite. Fix it without reopening the hole it closed.
--
-- 0022 made handle_new_user() honour the invite metadata only when auth.users.invited_at
-- is set, so a self-signup can never arrive as staff. Right idea, wrong moment: GoTrue
-- INSERTS the user first and sets invited_at in a follow-up UPDATE (Martin: created
-- 00:54:33, invited_at 00:54:43). At insert time invited_at is always NULL, so since 0022
-- every invited person has landed as client_member with no departments — invisible on
-- /admin/staff (which lists staff roles only) and bounced to /staff/no-access when they
-- click the link. Found 2026-09-23 when sam@ausdilaps.com.au was invited with
-- role=staff, departments=[reports] in her metadata and came through as client_member.
--
-- The insert path stays fail-closed exactly as 0022 left it. This adds the missing half:
-- when invited_at is SET on a user whose profile is still client_member, apply the invite
-- metadata then. `role = 'client_member'` guards it so a re-invite can never overwrite a
-- role an admin has since edited. A self-signup never gets an invited_at, so it never
-- fires for one.
--
-- app/admin/staff/actions.ts also writes the role straight after inviteUserByEmail()
-- returns, and repairs stuck rows when the list loads — so invites work before this is
-- pasted. This is the durable fix for the ledger and for any other invite path
-- (scripts/invite-admin.mjs).
--
-- Apply by pasting into the SQL editor (the Management API token is expired). Idempotent.

create or replace function public.handle_user_invited()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta_role text := nullif(new.raw_user_meta_data->>'role', '');
begin
  if meta_role in ('superadmin', 'admin', 'staff') then
    update public.profiles set
      role = meta_role::user_role,
      departments = case
        when jsonb_typeof(new.raw_user_meta_data->'departments') = 'array'
          then array(select jsonb_array_elements_text(new.raw_user_meta_data->'departments'))
        else '{}'::text[]
      end,
      can_manage_knowledge = coalesce((new.raw_user_meta_data->>'can_manage_knowledge')::boolean, false),
      invited_by = (new.raw_user_meta_data->>'invited_by')::uuid
    where id = new.id and role = 'client_member';
  end if;
  return new;
end;
$$;

comment on function public.handle_user_invited() is
  'Applies the invite metadata (role/departments/can_manage_knowledge) to a profile still at client_member when auth.users.invited_at is set — GoTrue sets it AFTER the insert handle_new_user() saw (0023).';

drop trigger if exists on_auth_user_invited on auth.users;
create trigger on_auth_user_invited
  after update of invited_at on auth.users
  for each row
  when (new.invited_at is not null and old.invited_at is distinct from new.invited_at)
  execute function public.handle_user_invited();

-- Repair everyone 0022 already caught: invited, staff metadata, still client_member.
update public.profiles p set
  role = (u.raw_user_meta_data->>'role')::user_role,
  departments = case
    when jsonb_typeof(u.raw_user_meta_data->'departments') = 'array'
      then array(select jsonb_array_elements_text(u.raw_user_meta_data->'departments'))
    else '{}'::text[]
  end,
  can_manage_knowledge = coalesce((u.raw_user_meta_data->>'can_manage_knowledge')::boolean, false),
  invited_by = (u.raw_user_meta_data->>'invited_by')::uuid
from auth.users u
where u.id = p.id
  and p.role = 'client_member'
  and u.invited_at is not null
  and u.raw_user_meta_data->>'role' in ('superadmin', 'admin', 'staff');
