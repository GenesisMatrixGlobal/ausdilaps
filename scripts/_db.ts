import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The service-role client, for scripts run under tsx.
 *
 * ⚠️ NOT `lib/supabase/admin.ts`. That module opens with `import "server-only"`, which is a
 * marker Next resolves during a build and which is NOT an installed package — so every
 * script importing it dies with `Cannot find module 'server-only'` before it does anything.
 * It had silently broken `check:summary`, `check:sources` and `purge:tenders`.
 *
 * Same env vars and the same two options as the app's client, so a script reads and writes
 * exactly what the app does. ⚠️ `SUPABASE_URL` is preferred over `NEXT_PUBLIC_SUPABASE_URL`
 * for the same reason `createAdminClient()` prefers it — the two have pointed at different
 * projects before, and a script writing to the retired database while reporting success is
 * the worst outcome available here.
 *
 * ⚠️ There is no dev database. Anything this writes is PRODUCTION.
 */
export function scriptDb(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase credentials. Need SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.local."
    );
  }

  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
