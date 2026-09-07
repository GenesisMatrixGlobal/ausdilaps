/**
 * Verify every legacy URL resolves before (and immediately after) the domain cutover.
 *
 *   npm run check:redirects                              # ausdilaps.vercel.app
 *   npm run check:redirects https://ausdilaps.com.au     # after the DNS change
 *
 * Checks two things:
 *   1. Every entry in data/redirects.ts lands on its destination — tested BOTH
 *      slash-less and with a trailing slash, because every legacy WordPress URL
 *      ended in "/" and that is the form Google actually has indexed. next.config.ts
 *      sets no `trailingSlash`, so the real legacy form is a double hop
 *      (301 strip-slash -> 301 destination). Both must arrive.
 *   2. Every URL in the deployed sitemap returns 200.
 *
 * Exits non-zero if anything fails, so it can gate a cutover.
 */
import { REDIRECTS } from "../data/redirects";

const base = (process.argv[2] ?? "https://ausdilaps.vercel.app").replace(/\/$/, "");
const CONCURRENCY = 8;

// A path pattern can't be fetched, so parameterised sources need a concrete
// example. Keep these realistic — they are the URLs actually in the wild.
const CONCRETE: Record<string, string> = {
  "/portfolio_categories/:cat": "/portfolio_categories/rail",
  "/wp-content/uploads/:path*":
    "/wp-content/uploads/2025/04/AusDilaps-Sample-Tunnel.pdf",
};

type Check = {
  label: string;
  path: string;
  expect: string;
  /** Anonymous /staff/* is bounced to the login page by proxy.ts — that is correct. */
  staffGate?: boolean;
};

type Outcome = Check & { status: number; finalPath: string; hops: number; ok: boolean };

async function chase(path: string): Promise<{ status: number; finalPath: string; hops: number }> {
  let url = base + path;
  let hops = 0;
  for (let i = 0; i < 6; i++) {
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", method: "HEAD" });
    } catch (e) {
      return { status: 0, finalPath: `fetch failed: ${(e as Error).message}`, hops };
    }
    // Some static assets reject HEAD; retry that one hop as GET.
    if (res.status === 405) res = await fetch(url, { redirect: "manual" });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, url).toString();
      hops++;
      continue;
    }
    return { status: res.status, finalPath: new URL(url).pathname, hops };
  }
  return { status: 0, finalPath: "too many redirects", hops };
}

function buildRedirectChecks(): Check[] {
  const checks: Check[] = [];
  for (const r of REDIRECTS) {
    const concrete = CONCRETE[r.source] ?? r.source;
    if (concrete.includes(":")) {
      console.warn(`  ! no concrete example for ${r.source} — skipped`);
      continue;
    }
    const staffGate = r.destination.startsWith("/staff");
    // Slash-less, then the trailing-slash form Google has indexed.
    checks.push({ label: r.source, path: concrete, expect: r.destination, staffGate });
    if (!concrete.includes(".")) {
      checks.push({
        label: `${r.source} (trailing slash)`,
        path: `${concrete}/`,
        expect: r.destination,
        staffGate,
      });
    }
  }
  return checks;
}

async function sitemapChecks(): Promise<Check[]> {
  const res = await fetch(`${base}/sitemap.xml`);
  if (!res.ok) throw new Error(`sitemap.xml returned ${res.status}`);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  // The sitemap is built from NEXT_PUBLIC_SITE_URL, which may still point at the
  // OLD WordPress origin. Test the path against the target base, not that origin.
  return locs.map((loc) => {
    const p = new URL(loc).pathname;
    return { label: p, path: p, expect: p };
  });
}

async function run(checks: Check[]): Promise<Outcome[]> {
  const out: Outcome[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < checks.length) {
        const c = checks[i++];
        const r = await chase(c.path);
        const arrived = r.finalPath === c.expect;
        const gated = !!c.staffGate && r.finalPath === "/staff/login";
        out.push({ ...c, ...r, ok: (arrived || gated) && r.status < 400 });
      }
    })
  );
  return out;
}

function report(title: string, rows: Outcome[]): number {
  const fails = rows.filter((r) => !r.ok);
  console.log(`\n${title} — ${rows.length - fails.length}/${rows.length} passed`);
  for (const r of fails) {
    console.log(
      `  FAIL  ${r.label}\n        expected ${r.expect}, got ${r.finalPath} (HTTP ${r.status}, ${r.hops} hop${r.hops === 1 ? "" : "s"})`
    );
  }
  return fails.length;
}

(async () => {
  console.log(`Checking ${base}\n`);

  const redirectRows = await run(buildRedirectChecks());
  redirectRows.sort((a, b) => a.label.localeCompare(b.label));
  let failed = report("Redirects", redirectRows);

  const gated = redirectRows.filter((r) => r.ok && r.staffGate && r.finalPath === "/staff/login");
  if (gated.length) {
    console.log(`  note: ${gated.length} staff redirect(s) ended at /staff/login — correct for an anonymous request`);
  }

  const sitemapRows = await run(await sitemapChecks());
  sitemapRows.sort((a, b) => a.label.localeCompare(b.label));
  failed += report("Sitemap URLs", sitemapRows);

  console.log(failed === 0 ? "\nAll good.\n" : `\n${failed} failure(s).\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
