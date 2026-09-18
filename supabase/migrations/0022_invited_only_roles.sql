-- 0022 — a self-signup can never arrive as staff, whatever the dashboard says.
--
-- handle_new_user (0005, widened in 0009) reads role, departments and can_manage_knowledge
-- from raw_user_meta_data. That field is whatever the CALLER put in `data` on
-- /auth/v1/signup or /auth/v1/otp — a request anyone can make with the public anon key.
-- The only thing between that and a self-provisioned superadmin was the Supabase
-- dashboard toggle "Allow new users to sign up" (found by the 2026-09-10 security sweep;
-- the toggle IS off on Sydney, verified via /auth/v1/settings, so this was latent).
--
-- Supabase sets auth.users.invited_at when an account is created through
-- inviteUserByEmail (which is how /admin/staff and scripts/invite-admin.mjs create every
-- staff account) and leaves it NULL for a self-signup. So: honour the metadata for an
-- invited user, and file everyone else as client_member with no departments — which
-- lib/auth/session.ts already refuses at the door.
--
-- ⚠️ scripts/login-link.mjs notes that admin.generateLink() can also create an account;
-- it sets no metadata, so it lands as client_member either way. Unchanged.
--
-- Apply by pasting into the SQL editor (the Management API token is expired). Idempotent.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  invited   boolean := new.invited_at is not null;
  meta_role text    := nullif(new.raw_user_meta_data->>'role', '');
  new_role  user_role;
begin
  new_role := case
    when invited and meta_role in ('superadmin', 'admin', 'staff') then meta_role::user_role
    else 'client_member'::user_role
  end;

  insert into public.profiles (id, email, full_name, role, departments, invited_by, can_manage_knowledge)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data->>'full_name', ''),
    new_role,
    case
      when invited and jsonb_typeof(new.raw_user_meta_data->'departments') = 'array'
        then array(select jsonb_array_elements_text(new.raw_user_meta_data->'departments'))
      else '{}'::text[]
    end,
    case when invited then (new.raw_user_meta_data->>'invited_by')::uuid else null end,
    invited and coalesce((new.raw_user_meta_data->>'can_manage_knowledge')::boolean, false)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the profile for a new auth user. Role/departments/can_manage_knowledge come from the invite metadata ONLY when invited_at is set; a self-signup is always client_member (0022).';
