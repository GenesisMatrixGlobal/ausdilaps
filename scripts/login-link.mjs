// Print a working sign-in link, without sending an email.
//
//   npm run login-link                        -> link for ADMIN_EMAIL, pointed at localhost:3000
//   npm run login-link -- someone@ausdilaps.com.au
//   npm run login-link -- someone@ausdilaps.com.au https://ausdilaps.vercel.app
//
// Why this exists: Supabase's built-in email sender allows only a couple of messages an
// hour, so testing sign-in repeatedly hits "email rate limit exceeded". And the Invite
// template is built from Supabase's Site URL, so invite emails always point at the
// deployed site even when you're working on localhost.
//
// admin.generateLink() RETURNS a link instead of sending one, so it sidesteps both:
// no email, no rate limit, and you choose the origin.
//
// The printed link is a real single-use credential valid for one hour — treat it like a
// password. This is a local developer convenience; staff get theirs by email as normal.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const [emailArg, siteArg] = process.argv.slice(2);
const site = (siteArg || "http://localhost:3000").replace(/\/$/, "");

// No default address, deliberately. admin.generateLink() CREATES the user when the email
// is unknown — it's an admin API, so it bypasses the "disable signups" setting. Guessing
// at ADMIN_EMAIL here silently created a stray client_member account the first time this
// ran. Always name the account you mean.
if (!emailArg) {
  console.error(
    "Usage: npm run login-link -- <email> [site-url]\n\n" +
      "  npm run login-link -- rhys.m@ausdilaps.com.au\n" +
      "  npm run login-link -- rhys.m@ausdilaps.com.au https://ausdilaps.vercel.app"
  );
  process.exit(1);
}
const email = emailArg;

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error(
    "✗ Missing Supabase credentials in .env.local:\n" +
      "  NEXT_PUBLIC_SUPABASE_URL=…\n" +
      "  SUPABASE_SERVICE_ROLE_KEY=…   (Supabase → Project Settings → API → service_role)"
  );
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

// Confirm the account already exists before asking for a link — generateLink would
// otherwise create one for a typo'd address.
const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (listErr) {
  console.error("✗ Couldn't list users:", listErr.message);
  process.exit(1);
}
if (!list.users.some((u) => u.email?.toLowerCase() === email.toLowerCase())) {
  console.error(
    `✗ No account for ${email} — refusing to create one by accident.\n` +
      `  Invite them first:  node scripts/invite-admin.mjs ${email} "Their Name"`
  );
  process.exit(1);
}

const { data, error } = await supabase.auth.admin.generateLink({
  type: "magiclink",
  email,
  options: { redirectTo: `${site}/staff/auth/callback?next=/staff` },
});

if (error) {
  console.error(`✗ Couldn't generate a link for ${email}: ${error.message}`);
  if (/not found|no user/i.test(error.message)) {
    console.error(`  That address has no account. Create one first:\n` +
      `    node scripts/invite-admin.mjs ${email} "Their Name"`);
  }
  process.exit(1);
}

const token = data.properties?.hashed_token;
if (!token) {
  console.error("✗ Supabase returned no token. Check the account exists and is active.");
  process.exit(1);
}

console.log(`\nSign-in link for ${email} — paste into your browser:\n`);
console.log(`${site}/staff/auth/callback?token_hash=${token}&type=magiclink&next=/staff\n`);
console.log("Single use, expires in 1 hour.");
