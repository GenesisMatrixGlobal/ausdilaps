# Box → /samples live sync

`/dilapidation-reports/samples` renders live from a Box folder instead of a
hardcoded list. Drop a file into a category subfolder in Box and it appears
on the site on the next revalidation — no redeploy needed. Remove it and it
disappears the same way.

- **Client:** `lib/box.ts` (Box API) + `lib/samples.ts` (pure: titles, years, sizes, category order)
- **Page:** `app/(marketing)/dilapidation-reports/samples/page.tsx`
- **Library UI:** `components/marketing/samples-library.tsx` (category chips + compact list, client island — no search and no card grid, by request)
- **Target folder:** `https://ausdilaps.app.box.com/folder/405950982690`
- **Refresh:** Next.js ISR, `revalidate = 1800` (30 min)

## How categorisation works

Every **immediate subfolder** of the target folder becomes a category on the
page (e.g. `Residential`, `Commercial`, `Drone`, `Engineering Reports`). Files
inside a subfolder become that category's samples. One level of subfolders
only — nested subfolders inside a category aren't supported.

Any file sitting loose in the root (not filed into a subfolder yet) still
shows up, grouped under a trailing **"Other"** category — nothing silently
disappears, it just won't be sorted until you move it into a subfolder.

To add a new category, just create a subfolder in Box with the name you want
shown on the site. To rename a category, rename the subfolder.

**Order is fixed in code**, not alphabetical: `CATEGORY_ORDER` in `lib/samples.ts`
(Residential, Commercial, GPS & Council Assets, Roadways, Specialised Surveys,
Case Studies, General). Box lists folders A–Z, which put "Case Studies" and
"General" ahead of the reports people come for. A folder not in that list is
appended alphabetically; "Other" is always last. Matching is case-insensitive.

**Only sample file types are published:** `pdf`, `png`, `jpg`/`jpeg`, `mp4`,
`mov` (`SAMPLE_EXTENSIONS` in `lib/box.ts`). Anything else in the folder — a
stray `.xlsx`, `.docx`, `.zip` — is logged and left out, and no shared link is
created for it. This exists because the page makes every file it publishes a
*public* download and several people hold Editor on the folder.

**Titles come from filenames**, with the boilerplate stripped
(`titleFromFilename` in `lib/samples.ts`): a leading "AusDilaps Sample" /
"AusDilaps" / "Case Study", any four-digit year (shown separately as the year),
underscores, and `_Redacted` → "(redacted)". So
`AusDilaps Sample 2026 - Hospital External.pdf` shows as **Hospital External ·
PDF · 8.3 MB · 2026**. Name files for the reader and the page follows.

**The page is a library, not a landing page.** People opening samples mostly
already hold a quote, so the page carries no "Request a Quote" button of its own
(the site header still does) — just phone and email in the hero and a quiet
contact band at the foot.

## On "daily" freshness

30-minute ISR is already more frequent than the daily check originally asked
for, so no separate cron/scheduled job was built. One caveat: Next.js
time-based ISR only re-fetches on the *next visit* after the window elapses —
on a low-traffic page it could sit stale for longer than 30 min between
visitors, but the moment someone loads the page it revalidates in the
background and the following request is fresh. If guaranteed freshness
regardless of traffic ever matters, add a Vercel Cron Job that pings
`https://ausdilaps.vercel.app/dilapidation-reports/samples` daily to force
a visit — not needed today.

## One-time Box setup (do this once, ~10 min)

The site authenticates to Box via **Client Credentials Grant** — a
service-to-service Box Custom App, no user login involved.

1. **Box Developer Console** → My Apps → **Create New App** → *Custom App* →
   Authentication Method: **Server Authentication (Client Credentials Grant)**.
2. Under **Configuration**:
   - Note the **Client ID** and **Client Secret**.
   - Under **App Access Level**, choose whichever scope Box requires for your
     enterprise (App + Enterprise Access is fine — this app only ever reads
     one folder).
   - Enable scopes: **Read all files and folders stored in Box** (read-only
     is enough; the site never writes/deletes).
3. **Submit for authorisation** in the console, then have a Box admin approve
   it in the **Box Admin Console** → Apps → Custom Apps Manager.
4. Once authorised, Box auto-generates a **Service Account** for the app
   (an email like `AutomationUser_XXXX@boxdevedition.com`). Copy it.
5. In Box, open the target folder
   (`https://ausdilaps.app.box.com/folder/405950982690`) → **Share** → invite
   the Service Account email as a **Viewer**. That is the least privilege that
   works and it is enough: a Viewer can create a shared link (`PUT /files/:id`
   returns 200 — verified 2026-09-11) but cannot delete, move or upload (DELETE
   returns 403). Do NOT give it Editor here; nothing on this page needs it, and
   the bot's only job is to copy a link. (Previewer / Uploader roles are NOT
   enough — they cannot create shared links.)
   - **Who holds Editor matters more than the bot's role.** Editor on this
     folder = the ability to publish a public download on ausdilaps.com.au
     within 30 minutes. Keep it to one or two internal people; external
     collaborators should be Viewers.
6. Grab the **Enterprise ID** from Box Admin Console → Account & Billing.
7. Set these in `.env.local` and in Vercel → Project → Settings →
   Environment Variables for **Production AND Preview** — without the Preview
   copy every branch preview 404s this page (`BoxConfigError` → `notFound()`),
   which is how it stood until 2026-09-11:

   ```
   BOX_CLIENT_ID=...
   BOX_CLIENT_SECRET=...
   BOX_ENTERPRISE_ID=...
   BOX_SAMPLES_FOLDER_ID=405950982690
   ```

8. Organise the folder into subfolders by category (e.g. `General`,
   `Residential`, `Commercial`, `GPS & Council Assets`, `Roadways, Rail & Tunnels`,
   `Drone & Culvert`, `Engineering Reports`) and drop the sample PDFs into
   each. The page picks it up on the next revalidation — no redeploy.

## Box is the only source — there is no fallback

There used to be a static `FALLBACK_CATEGORIES` list in `page.tsx`. It was
**removed at the domain cutover**: every URL in it pointed at
`ausdilaps.com.au/wp-content/uploads/...`, and once that domain resolves to this
site instead of WordPress, all 19 links 404. A fallback that serves dead links is
worse than no page.

So if Box can't be read, `/dilapidation-reports/samples` returns a **404** — both
when `listBoxFolderCategories()` throws and when it comes back empty. Two things
keep that from being a real risk:

- **ISR.** `revalidate = 1800` means a failed background revalidation leaves the
  last good render in place, so a transient Box outage never reaches a visitor.
  Only a cold build with Box down would 404.
- **Partial failures don't cascade.** `resolveSamples()` and the category fan-out
  in `lib/box.ts` both use `Promise.allSettled`, so one file whose shared-link PUT
  fails (a file the service account can't see, or a Box hiccup), or
  one unreadable subfolder, drops that row and logs it rather than taking down the
  whole page.

If the env vars are missing entirely, `getAccessToken()` throws `BoxConfigError`
and the page 404s — deliberately loud, because a silently empty samples page on a
ranking URL is worse than an obvious break.
