/**
 * Is the service-role client configured? The same env vars `createAdminClient()` reads,
 * checked without constructing it — that throws on a missing var, and a page or route that
 * 500s is a worse failure than one that says what is missing.
 *
 * ⚠️ Deliberately NOT in lib/supabase/admin.ts. That module opens with `import "server-only"`,
 * which does not resolve under tsx, and lib/tenders/summary.ts is also run by the check
 * scripts. This file must stay import-free so it is safe everywhere.
 */
export function adminClientConfigured(): boolean {
  return !!(
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY) &&
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)
  );
}
