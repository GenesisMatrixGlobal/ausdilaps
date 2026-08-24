// Invite the first company admin — the one-time bootstrap.
//
// /admin/staff can invite everyone else, but it needs an admin to be signed in,
// so the very first superadmin has to come from outside the app. Run this once,
// straight after `npm run migrate`:
//
//   node scripts/invite-admin.mjs rhys.m@ausdilaps.com.au "Rhys Morgan"
//
// Needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
// (or SUPABASE_SECRET_KEY) in .env.local, and NEXT_PUBLIC_SITE_URL for the link.
// Safe to re-run: an existing user is promoted rather than re-created.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const [email, fullName] = process.argv.slice(2);
if (!email || !email.includes("@")) {
  console.error('Usage: node scripts/invite-admin.mjs <email> ["Full Name"]');
  process.exit(1);
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error(
    "✗ Missing Supabase credentials. Add to .env.local:\n" +
      "  NEXT_PUBLIC_SUPABASE_URL=…\n" +
      "  SUPABASE_SERVICE_ROLE_KEY=…   (Supabase → Project Settings → API → service_role)"
  );
  process.exit(1);
}

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
const redirectTo = `${siteUrl}/staff/auth/callback?next=/admin`;

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
  redirectTo,
  data: { full_name: fullName || null, role: "superadmin", departments: [] },
});

if (error) {
  // Already exists (a re-run, or they were invited as ordinary staff) — promote.
  if (/already been registered|already exists/i.test(error.message)) {
    const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) {
      console.error("✗ Could not look up the existing user:", listErr.message);
      process.exit(1);
    }
    const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!existing) {
      console.error(`✗ ${email} is registered but wasn't found in the user list.`);
      process.exit(1);
    }
    const { error: upErr } = await supabase
      .from("profiles")
      .update({ role: "superadmin", is_active: true })
      .eq("id", existing.id);
    if (upErr) {
      console.error("✗ Could not promote the existing profile:", upErr.message);
      process.exit(1);
    }
    console.log(`✓ ${email} already had an account — promoted to superadmin.`);
    console.log(`  Sign in at ${siteUrl}/staff/login`);
    process.exit(0);
  }

  console.error("✗ Invite failed:", error.message);
  console.error(
    "  If this is a rate limit, point Supabase → Auth → SMTP at Resend first\n" +
      "  (the built-in email sender allows only a couple of messages an hour)."
  );
  process.exit(1);
}

console.log(`✓ Invited ${email} as superadmin (user ${data.user?.id}).`);
console.log(`  Check that inbox and click the link — it lands on ${siteUrl}/admin`);
