-- Adds the 'staff' role to user_role. DELIBERATELY ALONE IN THIS FILE.
--
-- scripts/migrate.mjs sends each .sql file as a single multi-statement
-- client.query(), which Postgres runs inside an implicit transaction — and a
-- new enum value cannot be *used* in the same transaction that adds it
-- ("unsafe use of new value of enum type"). So the ADD VALUE lands here and
-- everything that references 'staff' lives in 0005.
--
-- Roles: superadmin / admin = company admins (all departments + /admin).
--        staff              = department access only (/staff).
--        client_admin / client_member = dormant, future client portal.
--
-- IDEMPOTENT: safe to run repeatedly.

alter type user_role add value if not exists 'staff';
