# Box → /samples live sync

`/dilapidation-reports/samples` renders live from a Box folder instead of a
hardcoded list. Drop a file into a category subfolder in Box and it appears
on the site on the next revalidation — no redeploy needed. Remove it and it
disappears the same way.

- **Client:** `lib/box.ts`
- **Page:** `app/(marketing)/dilapidation-reports/samples/page.tsx`
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
shown on the site. To reorder or rename a category, rename/reorder the
subfolder in Box.

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
   the Service Account email as a **Viewer** (or Editor if you want the app
   able to create shared links on files it didn't create — it needs at least
   enough access to add a shared link per file, so use **Editor** if Viewer
   turns out to be insufficient for `PUT /files/:id`).
6. Grab the **Enterprise ID** from Box Admin Console → Account & Billing.
7. Set these in `.env.local` (and in Vercel → Project → Settings →
   Environment Variables for production):

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

Until these env vars are set (or if Box is briefly unreachable), the page
falls back to a static hardcoded list (`FALLBACK_CATEGORIES` in `page.tsx`)
so it never breaks or ships empty.
