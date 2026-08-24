-- Staff portal — per-user auth + department access for /staff and /admin.
--
-- Replaces the single shared ADMIN_ACCESS_PASSWORD gate with real Supabase Auth
-- accounts. Departments are stored as a text[] on profiles; the canonical list of
-- valid slugs lives in lib/departments.ts (code is the source of truth so adding a
-- department needs no migration).
--
-- Depends on 0004 having added 'staff' to user_role.
-- IDEMPOTENT: safe to run repeatedly.

-- ── profiles: department access + lifecycle ────────────────────────────
alter table public.profiles add column if not exists departments  text[] not null default '{}';
alter table public.profiles add column if not exists is_active    boolean not null default true;
alter table public.profiles add column if not exists invited_by   uuid references auth.users(id) on delete set null;
alter table public.profiles add column if not exists last_seen_at timestamptz;

-- ── auto-create a profile for every new auth user ──────────────────────
-- Without this, an invited user has no profile row, so the role lookup in
-- lib/auth/session.ts finds nothing and denies them. The invite call
-- (auth.admin.inviteUserByEmail) passes full_name / role / departments through
-- raw_user_meta_data; this copies them across.
--
-- Fail-closed: a user created by any other route (no 'role' in metadata) lands as
-- client_member with no departments, which the staff gate rejects outright.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta_role text := nullif(new.raw_user_meta_data->>'role', '');
  new_role  user_role;
begin
  new_role := case
    when meta_role in ('superadmin', 'admin', 'staff') then meta_role::user_role
    else 'client_member'::user_role
  end;

  insert into public.profiles (id, email, full_name, role, departments, invited_by)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data->>'full_name', ''),
    new_role,
    case
      when jsonb_typeof(new.raw_user_meta_data->'departments') = 'array'
        then array(select jsonb_array_elements_text(new.raw_user_meta_data->'departments'))
      else '{}'::text[]
    end,
    (new.raw_user_meta_data->>'invited_by')::uuid
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── department helper (for future department-scoped RLS) ───────────────
-- SECURITY DEFINER so policies using it don't recurse on profiles, matching the
-- existing is_internal() / auth_org_id() helpers in 0001.
create or replace function public.has_department(dept text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (
      select p.is_active and (p.role in ('superadmin', 'admin') or dept = any(p.departments))
      from public.profiles p
      where p.id = auth.uid()
    ),
    false
  );
$$;

-- ── close the self-update privilege-escalation hole ────────────────────
-- The 0001 policy had a USING clause but no WITH CHECK, so an authenticated user
-- could UPDATE their own row and set role/departments/is_active to anything.
-- All profile writes now go through service-role server actions in /admin, which
-- matches the design note at the top of 0001 ("privileged writes happen
-- server-side via the service-role key").
drop policy if exists "profiles self update" on public.profiles;

-- is_internal() stays admin|superadmin only. Ordinary 'staff' must NOT inherit
-- read access to leads or the dormant portal tables.
