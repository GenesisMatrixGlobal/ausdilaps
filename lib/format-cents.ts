// "25c" under a dollar, "$1.23" from there — for the counters the tools show about themselves.
//
// Its own file, and a PURE one, deliberately. It started life in lib/api-usage.ts, whose dynamic
// `import("@/lib/supabase/admin")` Turbopack still traces when a CLIENT component imports the
// module — so one formatter pulled "server-only" into the browser bundle and took the whole
// staff tool page down with it. Nothing in here may import anything.
export function formatCents(cents: number): string {
  if (cents < 100) return `${cents < 10 ? (Math.round(cents * 10) / 10).toString() : Math.round(cents)}c`;
  return `$${(cents / 100).toFixed(2)}`;
}
