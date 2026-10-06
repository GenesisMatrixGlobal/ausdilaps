// npm run check:safe-next — pure. The ?next= redirect after sign-in must stay on this site
// (lib/auth/safe-next.ts). Every off-site case here was a real bypass at some point.
import assert from "node:assert/strict";
import { safeNext } from "@/lib/auth/safe-next";

const OFF_SITE = [
  "//evil.com",
  "/\\evil.com",
  "https://evil.com",
  // Dot segments collapse to "//evil.com" after parsing (2026-10-06 sweep).
  "/.//evil.com",
  "/%2e//evil.com",
  "/a/..//evil.com",
  "/./\\evil.com",
];
for (const next of OFF_SITE) assert.equal(safeNext(next), "/staff", next);

assert.equal(safeNext("/staff/estimators/tools/site-markups"), "/staff/estimators/tools/site-markups");
assert.equal(safeNext("/admin/usage?month=2026-09"), "/admin/usage?month=2026-09");
assert.equal(safeNext("/staff/login"), "/staff"); // never loop back onto login
assert.equal(safeNext(null), "/staff");
console.log(`✓ safe-next: ${OFF_SITE.length} off-site redirects refused, on-site paths kept`);
