-- 0020: who used the tool.
--
-- 0008 left the user off tool_usage on purpose ("the question is which tools get used, not
-- who is using them") and said adding one later would be a migration. This is that
-- migration. Rhys asked on 2026-09-18 for basic per-person tracking — last login and tool
-- uses on the staff cards — so admins can see who is actually using the portal and who is
-- not. Staff are told through the /admin/staff page itself, which shows the figures.
--
-- Nullable: every row written before this lands has no user, and a dev-bypass request
-- (local only) has none either. ON DELETE SET NULL so removing a staff member keeps the
-- tool's history — the count on /admin/tools must not drop when someone leaves.
--
-- The writer (lib/tools/usage.ts recordToolUse) retries WITHOUT user_id when the column is
-- missing, and the reader selects without it, so a deploy landing before this paste records
-- and reports exactly as it did before. Apply, then `notify pgrst, 'reload schema'`.
--
-- IDEMPOTENT: safe to run repeatedly.

alter table public.tool_usage
  add column if not exists user_id uuid references auth.users(id) on delete set null;

-- "This person's uses in the last 30 days" is the shape /admin/staff asks for.
create index if not exists tool_usage_user_idx on public.tool_usage(user_id, used_at desc);

notify pgrst, 'reload schema';
