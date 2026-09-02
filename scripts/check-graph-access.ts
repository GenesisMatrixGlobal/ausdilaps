/**
 * Independent check that the Graph app can read the tenders mailbox AND NOTHING ELSE.
 *
 *   npm run check:graph
 *
 * Deliberately self-contained — it re-implements the token call and the two requests
 * rather than importing lib/tenders/sources/mailbox.ts. If the adapter had a bug that
 * silently pointed at the wrong mailbox, a check built on the adapter would inherit it.
 *
 * Read-only: no writes, no classification, no Anthropic calls, no cost.
 *
 * The test that matters is #3. Exchange's Test-ServicePrincipalAuthorization already says
 * the app is scoped, but that cmdlet bypasses the permission cache — it reports intent,
 * not what the live API will actually do. This exercises the real path.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const GRAPH = "https://graph.microsoft.com/v1.0";

const tenant = process.env.MS_GRAPH_TENANT_ID;
const clientId = process.env.MS_GRAPH_CLIENT_ID;
const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET;
const mailbox = process.env.TENDER_MAILBOX;

/** A mailbox the app must NOT be able to read. Override with CHECK_OTHER_MAILBOX. */
const other = process.env.CHECK_OTHER_MAILBOX ?? "rhys.m@ausdilaps.com.au";

if (!tenant || !clientId || !clientSecret || !mailbox) {
  console.error("Missing Graph config in .env.local. Need:");
  console.error("  MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, TENDER_MAILBOX");
  process.exit(1);
}

async function token(): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId!,
      client_secret: clientSecret!,
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

const get = (t: string, path: string) =>
  fetch(`${GRAPH}${path}`, { headers: { authorization: `Bearer ${t}` } });

async function main() {
  let failures = 0;
  const ok = (pass: boolean, label: string, detail = "") => {
    if (!pass) failures++;
    console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };

  console.log(`tenant ${tenant!.slice(0, 8)}…  app ${clientId!.slice(0, 8)}…  mailbox ${mailbox}\n`);

  // ── 1. Can we authenticate at all? ────────────────────────────────────
  let t: string;
  try {
    t = await token();
    ok(true, "got an access token");
  } catch (e) {
    ok(false, "got an access token", (e as Error).message);
    console.log("\nThe secret or tenant is wrong. Nothing else can be checked.");
    process.exit(1);
  }

  // ── 2. Can it read the mailbox it is supposed to? ─────────────────────
  const mine = await get(t, `/users/${encodeURIComponent(mailbox!)}/messages?$top=1&$select=id`);
  ok(mine.status === 200, `can read ${mailbox}`, `HTTP ${mine.status}`);
  if (mine.status === 403) {
    console.log("\n  403 here usually means Exchange's permission cache hasn't caught up.");
    console.log("  It can take up to 2 hours. Re-run rather than start changing things.");
  }

  // ── 3. THE ONE THAT MATTERS ───────────────────────────────────────────
  const theirs = await get(t, `/users/${encodeURIComponent(other)}/messages?$top=1&$select=id`);
  ok(theirs.status === 403, `is REFUSED on ${other}`, `HTTP ${theirs.status}`);
  if (theirs.status === 200) {
    console.log("\n  *** STOP. The app can read another person's mailbox. ***");
    console.log("  Mail.Read is still consented in Entra ID under API permissions.");
    console.log("  That grant is org-wide and overrides the Exchange scoping.");
    console.log("  Remove it, wait for the cache, and re-run before going further.");
  }

  // ── 4. What is actually in there? ─────────────────────────────────────
  if (mine.status === 200) {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 19) + "Z";
    const res = await get(
      t,
      `/users/${encodeURIComponent(mailbox!)}/messages?$top=100&$select=from,subject,receivedDateTime&$filter=receivedDateTime ge ${since}`
    );
    if (res.ok) {
      const body = (await res.json()) as {
        value?: { from?: { emailAddress?: { address?: string } }; subject?: string }[];
      };
      const counts = new Map<string, number>();
      for (const m of body.value ?? []) {
        const d = m.from?.emailAddress?.address?.split("@").pop()?.toLowerCase();
        if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
      }
      console.log(`\nLast 7 days: ${body.value?.length ?? 0} messages from ${counts.size} domains.`);
      console.log("Each becomes its own tracked source on the first scan:\n");
      for (const [domain, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(n).padStart(3)}  email:${domain}`);
      }
      if (counts.size === 0) console.log("  (nothing in the last 7 days)");
    }
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
