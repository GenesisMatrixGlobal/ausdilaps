# AusDilaps — Project Brief & Big-Build Plan

**Read this first. It is the full context for the AusDilaps website. Paste it into a fresh session or rely on it auto-loading. Build from the REAL content referenced here — never invent stats, claims, or projects.**

---

## 1. What this is

A ground-up rebuild of **ausdilaps.com.au** for **AusDilaps — Specialist Building Inspections**, Australia's specialist **dilapidation (building condition) report** firm. ~$5M revenue, family-owned, 15 years, team <50. Legal entity **Urban Pulse Strategies Pty Ltd T/A AusDilaps**, ABN **82 650 700 226**, postal address **PO Box 3270, Rouse Hill NSW 2155** (changed 2026-10-06 from PO Box 81, Aspley QLD — `SITE.address` in `lib/site.ts` is the one source; the footer, every email footer, the privacy policy and the LocalBusiness schema read it or match it), Australia-wide. **No office anywhere (Rhys, 2026-10-06): fully remote, staff permanently based in NSW (Sydney = main base of operations), QLD, VIC and SA** — never write "Queensland-based" or name an office; `data/locations.ts` was reworded that day.

It replaces an old WordPress/Tatsu site (kept locally as a read-only reference at `20260616-AusDilaps-WordPress/` — git/vercel-ignored). The live old site still ranks for hundreds of terms; **we must preserve that** (see §7).

**This repo is one thing: a marketing + lead-generation + content platform.** There are **NO client logins** here. A future client portal will be a **separate system** — do not build it here.

---

## 2. The vision — the best this can be

Not a brochure. The goal is to make AusDilaps **the category authority** in Australian dilapidation reporting:

1. **SEO + AEO + GEO dominance.** Own the informational long tail, win the AI overviews / featured snippets / People-also-ask / local packs already showing on these terms, and become the **source LLMs cite** (GEO: structured data everywhere, answer-first copy, E-E-A-T, `llms.txt`).
2. **Expansive & deep.** Every service, sector, location, and the full 22-project portfolio — each a real, schema-rich page. Not consolidated away; the long tail is the moat.
3. **A content & news engine** that makes AusDilaps the voice of the industry — natural events (earthquakes, storms, cyclones, floods), major projects (Brisbane 2032, Sydney/Melbourne tunnels), dilapidation knowledge, and **advocacy** (lobbying state governments to adopt compulsory dilapidation reporting — the NSW model). This is the thought-leadership + lobbying platform.
4. **A conversion machine.** Every page routes to a qualified quote. The form captures real project detail, classifies the lead (Tier-1 vs residential), and pushes to Salesforce.
5. **Craft an engineer is proud of.** Fast, accessible, precise, beautiful. Hybrid light/charcoal design from the logo.

**Positioning line to build around:** *AusDilaps is the Tier 1 dilapidation specialist Australian contractors and government agencies trust when a damage claim has to be defensible, not just delivered.* (StoryBrand: the customer — a project manager / contracts admin / council risk officer — is the hero; we are the guide with Tier-1 proof + structural engineers. Never write "chartered" — nobody has confirmed a CPEng, Rhys softened it 2026-10-06.)

---

## 3. Current state (already built & LIVE — don't redo)

- **Tool and subsystem notes live in `.claude/rules/*.md`** (moved out of this file 2026-10-26; each loads only when Claude touches that tool's files): `staff-portal`, `tender-watch`, `quote-builder`, `cadastre-and-sizing`, `quote-lines`, `cover-photo`, `transcription-buddy`, `overview-markup`, `staff-games`, `knowledge-base`, `samples`, `admin-analytics`. **Put new tool notes in the matching rules file (or a new one with `paths:` frontmatter), not here** — this file loads into every session.
- **Every paid Google/Anthropic `fetch` is followed by `void recordApiCall({...})`** (`lib/api-usage.ts`) — that is how `/admin/usage` splits spend per tool. Details in `.claude/rules/admin-analytics.md`.
- **Repo (`origin`, Vercel-connected):** `github.com/GenesisMatrixGlobal/ausdilaps` — **every push to `main` auto-deploys** to Vercel (`ausdilaps.vercel.app`). Secondary remotes kept locally: `ausdilaps-master` (`AusDilaps-Master/ausdilaps`, private, the previous canonical) and `old-mypixel` (`MyPixelStrategy/ausdilaps`, dead).
- **Pages live (Phases 1–7 BUILT — don't redo):**
  - `/` homepage, `/faq`. (`/styleguide` was deleted 2026-10-06 — it showed the retired sky-blue palette.)
  - **Pillar + locations + samples:** `/dilapidation-reports` (Service + HowTo + FAQPage), `/dilapidation-reports/[location]` (6 cities sydney/brisbane/melbourne/wollongong/canberra/perth — legacy nested slug `dilapidation-reports-<city>`, per-city LocalBusiness + Service + HowTo + FAQ), `/dilapidation-reports/samples`.
  - **Services (10):** `/our-services` index + `/our-services/[slug]` (commercial/residential/industrial dilapidation, structural-engineering, aerial-drone-surveys, noise-and-vibration-monitoring-services, defect-origin-assessments-doa, highways-roads, structural-integrity-assessments, defect-comparison-assessments). Data: `data/services.ts`.
  - **Portfolio (24):** `/portfolio` filterable index + `/portfolio/[slug]` — 21 real projects (verbatim legacy slugs) + 3 case studies. Data: `data/portfolio.ts` (+ `data/case-studies.ts`). Imagery in `public/portfolio/` + `public/projects/`.
  - **Insights (MDX):** `/insights` + `/insights/[slug]` — `content/insights/*.mdx` via `lib/insights.ts` (gray-matter + next-mdx-remote/rsc). 3 articles live; tunnel/Brisbane-2032/natural-events still TODO (need grounded research).
  - **Lead engine:** `/quote` form + `/api/quote` (zod `lib/leads.ts` + tier classify, honeypot, env-gated Turnstile (rendered explicitly by `components/marketing/turnstile.tsx` — the old implicit `.cf-turnstile` div never rendered after a client-side navigation), junk filter `lib/spam.ts` (`npm run check:spam`; drops a post only when name AND message are both random mixed-case strings — the Oct 2026 Tor bot that typed strangers' emails so our ack email-bombed them), Supabase insert, Resend admin+ack, `LEAD_TEST_MODE`; no Salesforce sync — removed 2026-10-07, see §8). All CTAs → `/quote` via `QUOTE_HREF`.
  - **SEO:** `app/sitemap.ts` (51 urls, data-driven), `app/robots.ts`, `app/llms.txt/route.ts`, `data/redirects.ts` → `next.config.ts redirects()`, GA4 env-gated in `app/layout.tsx`.
- **Design system + brand** implemented (see §5). Real logo wired into header/footer. Mobile nav added.
- **Supabase project:** ref **`crqfxdywgxtxgpwrojyc`** — **"AusDilaps - Sydney", `ap-southeast-2`. THIS IS PRODUCTION.** All migrations `0001`–`0009` are applied (verified 2026-08-27 against it directly). Note `supabase_migrations.schema_migrations` is not maintained — migrations are applied as raw SQL and never write that ledger, so the schema is the truth, not the ledger.
- ⚠️ **`zjgntkfzgtrqkklglhpo` (Tokyo, `ap-northeast-1`) is the OLD project.** It was production until the 2026-08-26 move to Sydney and is kept only as a rollback path. An earlier version of this file called it "the one production uses" — that is now wrong, and a session nearly applied migration `0009` to it. **Check the ref before running anything.**
- ⚠️ **The two projects are on SEPARATE Supabase accounts.** A personal access token can only ever see the projects its own account owns, so the Tokyo token returns "account does not have the necessary privileges" against Sydney and vice versa. That is not a permissions setting you can fix — you need a token made on the account that owns "AusDilaps - Sydney".
- **Supabase MCP works.** `.mcp.json` (gitignored) pins `--project-ref=crqfxdywgxtxgpwrojyc` `--read-only`. Read-only, so migrations go via the Management API.
- **Applying a migration** (`npm run migrate` was DELETED 2026-10-06, with `scripts/migrate.mjs` and the `pg` dependency — its `DATABASE_URL` was the retired Tokyo project, so it applied to the dead database and reported success). POST the file to `https://api.supabase.com/v1/projects/crqfxdywgxtxgpwrojyc/database/query` with the token in `.env.local` as `SUPABASE_NEW_ACCESS_TOKEN`. Use curl, not python — Cloudflare 1010s unrecognised user-agents.
  - ⚠️ **`SUPABASE_NEW_ACCESS_TOKEN` is EXPIRED as of 2026-09-08** — the Management API returns a bare `{"message":"Unauthorized"}`, and the Supabase MCP server fails the same way for the same reason. Until it is reissued on the account that owns "AusDilaps - Sydney", a migration has to be pasted into the Supabase SQL editor by hand.
  - **Then run `notify pgrst, 'reload schema';`** or PostgREST keeps serving its cached schema and every new table reads as *"Could not find the table in the schema cache"*.
  - **Idempotency trap:** columns added inside `create table if not exists` never land on a database that already has the table. Put new columns in BOTH the create and an explicit `alter table ... add column if not exists`.
  - **`on conflict` cannot target a partial unique index.** PostgREST has no way to send the predicate, so use a plain unique index (NULLs compare as distinct, so partial-style behaviour still holds).
- ⚠️ **`.env.local` was pointing at Tokyo until 2026-08-27** and was silently testing against the retired database. It now points at Sydney; the old values are in `.env.local.bak-*`. If something reads as "table not found", check which project the env resolves to first — `createAdminClient()` prefers a bare `SUPABASE_URL` over `NEXT_PUBLIC_SUPABASE_URL`, which is what caused the post-migration "Invalid API key".
- ⚠️ **Local dev writes to PRODUCTION.** There is no separate dev database, so anything uploaded from localhost is a real row. Worth splitting before the team starts using the knowledge base.
- ❗ **`iiedgpurcsgakehrqzcr` is NOT an AusDilaps project.** It belongs to a separate, unrelated Supabase org. An earlier note here called it "a second, empty AusDilaps project" and said to delete one of the two — that was wrong, and acting on it would destroy unrelated work. Leave it alone.
- ✅ **DOMAIN CUTOVER IS DONE (2026-09-10).** `ausdilaps.com.au` serves this site from Vercel. Root `A` = `216.150.1.1`; the root `AAAA` was **deleted** (Vercel publishes no apex IPv6, and leaving it would have kept every IPv6 visitor on the old server — it was serving over IPv6 and this was nearly missed). `www` is untouched: it is a CNAME to the root and follows it, with Vercel 308-ing it to the apex. **Nameservers stayed at OnlyDomains** — moving them to Vercel would have destroyed the MX, SPF, both M365 DKIM selectors and the three Resend records. Verified after the change: 34/34 redirects, 51/51 sitemap URLs, form saving leads and sending mail.
  - ⚠️ **The old WordPress host SUSPENDED the account** (phishing) shortly before cutover, so there is no rollback — `139.180.173.43` serves a "Suspended Site" 503. The archive at `~/Documents/AusDilaps-WP-Archive` (89 pages, 23 PDFs, taken 2026-09-07, three days pre-incident) is the only copy of the old site.
  - ⚠️ **TTL was 86400 and OnlyDomains would not change it**, so stale resolvers served the suspension page for up to 24h afterwards. The office router (`192.168.0.1`) cached it and kept sending staff to the dead server long after every public resolver was correct — diagnose this with `dig @<resolver>` against the router AND `1.1.1.1` before believing the site is down.
- **Cutover tooling (keep — it is the regression check for redirects):** `npm run check:redirects [base-url]` checks every entry in `data/redirects.ts` — **both slash-less and trailing-slash**, since legacy WP URLs all ended in `/` and that's what Google indexed — plus every URL in the deployed sitemap. Exits non-zero. `scripts/mirror-wordpress.sh` archived the old site and was deleted 2026-10-06 (git history keeps it); the old origin is gone, so it could no longer run.
- ⚠️ **`/wp-content/uploads/:path*` now 301s to the samples page**, with the capability statement redirecting to the committed copy in `/public`. The specific entry MUST stay ahead of the wildcard in `data/redirects.ts` or the wildcard swallows it.
- **Off-site assets: `public/email/` (signature GIFs) and `public/field-service-icons/` (Salesforce Field Service map PNGs), 2026-09-11.** Fetched by mail clients and Salesforce users' browsers, never by a page here — nothing links to them, `robots.ts` disallows both, `next.config.ts headers()` gives them a year-long immutable cache (so change an image by ADDING a new filename, never overwriting), and a **Vercel firewall rule "Bypass: signature images + Field Service icons"** exempts both paths from bot challenges. That rule exists because Vercel's platform-level mitigation served a JS "Security Checkpoint" 403 to scripted fetches of these very files — an `<img>` in Salesforce or a mail proxy can't pass that, so it would show as a broken image with nothing to click. The rule was created via the Firewall API with the CLI token (`PATCH /v1/security/firewall/config`, `rules.insert`); the project had NO custom firewall config before it. Any future asset that another system pulls goes in a folder of its own and gets the same three things.
- ⚠️ **The enquiry form must import its option lists from `lib/leads-options.ts`, never `lib/leads.ts`** (speed sweep 2026-10-06). `lib/leads.ts` imports zod for the schema; one constant imported from it put a 63KB (gz) zod chunk on EVERY marketing page, because the header links to `/` and `/quote` are prefetched. `lib/leads.ts` re-exports the options, so server code is unaffected. The same sweep: `fetchPriority="high"` on the hero image (Next 16 no longer sets it from `priority`), `sizes` on both logos, Intercom imported inside its effect, `Button` renders a plain `<a>` for new-tab/file/external hrefs (the PDF was being prefetched as a route), week-long cache headers on `/logo`, `/clients` and the PDF.
- ⚠️ **A third of MOBILE HOMEPAGE loads record a CLS of 0.7–0.87 (web_vitals, Sep–Oct 2026), all cold loads, none with an interaction, and nothing reproduces it** — Lighthouse 0, warm-cache reload 0, tapping the form buttons 0.006. Since 2026-10-06 the reporter sends the biggest shift's elements and `/api/vitals` logs `[vitals] shift …` when CLS > 0.1 — read it with `npx vercel logs ausdilaps.com.au` and fix what it names. Nothing is stored; add a column if the log turns out to be worth keeping.
- ⚠️ **ANALYTICS WRITES ARE GATED ON `VERCEL_ENV === "production"`** (`isProductionRuntime()` in `lib/page-views.ts`, 2026-09-14) — used by `recordPageView`, `recordVitals` and `recordToolUse`. There is no dev database here, so before this gate every page load on localhost and every branch preview wrote a LIVE row. That is how `tool_usage` reached 377 rows dominated by the days the markup tools were being built, and how the first web-vitals rows arrived carrying a **21-second** load that was only Next compiling in dev. Any future counter must go through the same gate or it measures us instead of the business.
- **Enquiry notification is tracked as TWO booleans, never one** (migration `0017`). `leads.emailed` = the notice to info@ was accepted by Resend, which is the one that matters — a false there means a real enquiry nobody in the business knows about, and it raises the amber alert on `/admin` linking to `/admin/leads`. `leads.ack_emailed` = the courtesy acknowledgement to the enquirer, which is NOT alerted on because the enquiry is safe either way. ⚠️ `sendEmails()` used to return `adminSent && ackSent` into the single `emailed` column, so a bounced courtesy email raised "nobody was notified" for an enquiry info@ had received. `/admin/leads` draws a green ✓ / amber ✕ / muted dash per row from these. ⚠️ **"Sent" means Resend ACCEPTED it, not that it was delivered** — a later bounce is invisible; the wording says sent, never delivered.
- **Build is green.** Always keep it that way: `npm run build`.

---

## 4. Stack & conventions

- **Next.js 16.2.4 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 · shadcn/ui (style `base-nova`, neutral)**. Mirrors the sibling project `Sigma Sync/web`.
- **Email:** Resend. **CRM:** Salesforce (staff tools only; enquiries are not synced). **No R2, no Stripe** in v1.

---

## 5. Brand & design system

**Anchor = the logo** (`public/logo/ad-logo.png`, white version `ad-logo-white.png`). Steel-blue towers + "DILAPS"; charcoal "AUS" + "Specialist Building Inspections" tagline.

**Tri-colour palette** (tokens in `app/globals.css`):
- **Steel blue `#46688a`** — the brand (eyebrows, rules, links, accents). Tokens: `ad-steel` / `ad-accent`, light `ad-steel-light #6d90b4`.
- **Charcoal** — structural dark. `ad-ink #2f343a` (text), `ad-navy #2e3338` (dark bands), `ad-navy-deep #23272b` (footer/deep).
- **Orange `#e8642a`** (`ad-orange`) — **conversion accent only** (CTA buttons). Energy, used sparingly. Do NOT make it the theme.
- Base: white + `ad-surface #f3f4f5`; `ad-muted #5b6570`; borders `ad-border`.
- Fonts: **Space Grotesk** (headings, `--font-heading`), **Inter** (body). Low radius; `.rule-accent` (steel gradient) + `.rule-hairline` motifs; `.blueprint-grid` on dark bands.
- **Approach = hybrid:** light editorial base, **charcoal bands** for hero-proof/CTA/footer, large rounded photography, steel accents, orange CTAs. Reference aesthetic was the **Construktion X** template (clean, photo-led) — see `design-refs/` (gitignored).

**Components:** `components/ui/button.tsx` (cva variants: `primary` charcoal, `accent` orange, `outline`, `dark`, `onDark`, `onDarkAccent` orange, `onDarkOutline`), `components/marketing/{container,eyebrow,site-header,site-footer}.tsx`, `components/seo/json-ld.tsx`. **Reuse these; keep it consistent.**

**Known design TODOs:** header has **no mobile menu** yet (desktop nav only) — add one. Consider a header logo lockup without the tagline for small sizes.

---

## 6. Scope

**v1 (this repo):** marketing site (expansive, SEO/AEO/GEO) + **lead engine** (form → Supabase → Salesforce + email) + **staff portal** (`/staff` — department tools + training) + **admin** (`/admin` — staff access, tool registry; leads table + news authoring still TODO).
- **NO client logins, no report downloads, no payments** here. The portal-era Supabase tables (`organizations/projects/reports/...`) are written-but-dormant in the migration — leave them; v1 uses only `leads` (+ `profiles`/role for staff auth).
- A future client portal = a **separate system**.

---

## 7. Real content sources (USE THESE — never fabricate)

- **`~/Documents/projects/AusDilaps/Reference/Website/`** (`../Reference/Website/` from this repo) — external drop zone for source material (capability statements, competitor research, vendor docs, briefs, data exports, large files); see its `CLAUDE.md` for an index. Lives outside this repo (not git-tracked).
- **`lib/site.ts`** — SITE (ABN, contact, AS 4349.0), STATS (1,000+ surveys/qtr · 1M+ photos/yr · 1,300+ hrs/mo · 600+ work orders/mo), SERVICES (Dilapidation flagship + SIA + DOA + DCA), CAPTURE_METHODS, PROCESS (the real **6-step methodology**), TEAM (Mike Burford CEO, Rhys Morgan GM, Kylie Crosson, Niro Rudrakumar, Jessica Lebbos, Martin Weng), TIER1_PROJECTS.
- **`data/faq.ts`** — the real FAQ (Dilapidation, Structural, BASIX, NatHERS), harvested verbatim from the live site.
- **`data/case-studies.ts`** — 3 real case studies with values: Main South Road Duplication **$1.1bn**, Ipswich Hospital **$710M**, Glenrowan Solar Farm **$170M** (client, location, metrics).
- **`seo/legacy-seo-map.md`** — the live ranking URLs to PRESERVE + keyword clusters (the migration map).
- **`seo/content-backlog.md`** — future content targets (Sydney/Melbourne tunnels, Brisbane 2032, natural events, advocacy).
- **The live site `ausdilaps.com.au`** — harvest more page copy with WebFetch (verbatim) as you build each service/location/project page.
- **The FY25/26 Capability Statement** (`~/Documents/projects/AusDilaps/Reference/Website/AusDilaps Capability Statement FY25-26.pdf`) — stats, team, methodology, services (SIA/DOA/DCA/DCA), case studies, "Acknowledgement of Country", "Supporting Women in the Workplace", green mission. Re-read for any service/about/methodology content.
- **WP backup** `20260616-AusDilaps-WordPress/wp-content/uploads/` — real project & service imagery (read-only; copy/downscale into `public/`).

**Services taxonomy (lead with dilapidation):** Dilapidation Reports (Commercial / Residential / Industrial) · Structural Integrity Assessments (SIA) · Defect Origin Assessments (DOA) · Defect Comparison Assessments (DCA) · Structural Engineering · Aerial Drone Surveys · Noise & Vibration Monitoring · Highways & Roads · BASIX · NatHERS. Capture methods (frame under dilapidation): photography, roadway video, drone, LiDAR, point cloud / 3D model, culvert & pipe, GPS/georeferenced.

**22 portfolio projects** (preserve `/portfolio/<slug>`): Queens Wharf, NorthConnex, Brisbane Airport, North West Rail Link, Barangaroo South, Mona Vale Road Upgrade, Port Botany Bulk Liquids Berth, The Northern Road Upgrade, WestConnex, Blacktown / Northern Beaches / Canberra hospitals, HMAS facilities, Australian War Memorial, Zig Zag Railway, Epping–Thornleigh, B-Line, TfNSW Station Refresh, Adina/Four Seasons/Circular Quay hotels, Dapto Bridge + more (see WP backup).

---

## 8. The big build plan

Build in this order. Each page: real content, full JSON-LD, a CTA to the quote form, mobile-friendly, build green, push (auto-deploys).

**Phase 4 — News / Insights engine** (a PRIMARY pillar): `/insights` (or `/news`) index + categories — **Natural events** (earthquakes/storms/cyclones/floods), **Major projects** (Brisbane 2032, Sydney/Melbourne tunnels), **Dilapidation knowledge** (what-is/cost/samples), **Standards & advocacy** (compulsory reporting / NSW model / AS 4349.0). MDX-first (`content/insights/*.mdx`, `gray-matter`), Article/NewsArticle schema, author + E-E-A-T. **Run a grounded research pass (verify facts/dates) before publishing tunnel/Brisbane-2032 content.** Migrate the BASIX post.

**Phase 6 — Staff portal + admin:** ✅ Supabase per-user auth, departments, tool registry, training, `/admin/staff` invites (see §3 and `docs/staff-portal.md`). ✅ **`/admin/leads` BUILT 2026-09-14** — the enquiry list, linked from the admin nav and from both Enquiries tiles (`Stat` gained an optional `href`). One expandable `<details>` row per enquiry rather than a wide table: the form has eighteen fields and which are filled depends on the enquiry type, so a column per field would be mostly empty cells. **Read-only, and deliberately no statuses** — `leads.status` is in the schema and this app has never written it; a second half-maintained status field is worse than none. `routing='samples-unlock'` rows are excluded so the page agrees with the tile that links to it. ⚠️ **Enquiries are NOT synced to Salesforce and should not be** (Rhys, 2026-09-14) — `syncLeadToSalesforce` never ran (every lead row has `salesforce_id` and `sync_error` null) and was deleted with `SF_SYNC_ENABLED` on 2026-10-07. The Salesforce integration that IS wanted is the Quote Line Item create from the markup tools; don't confuse the two. **Still TODO:** a **news authoring UI** so the team publishes insights without a developer.

**Phase 7 — SEO/AEO/GEO finalisation:** `data/redirects.ts` → `next.config.ts redirects()` — **preserve live slugs; 301 only the dated blog post + PDF samples**. `app/sitemap.ts`, `app/robots.ts`, **`public/llms.txt`** (GEO), GA4 `G-81JV6BQ2R5`, validate every schema (Rich Results), Lighthouse > 90. Domain cutover ✅ **DONE 2026-09-10** — see §3.

**Cross-cutting:** mobile nav, accessibility, image optimisation, breadcrumbs everywhere.

---

## 9. Guardrails

- **Real content only.** Pull from §7 / live site / capability statement. Never fabricate stats, clients, or claims (this is a $5M firm with government clients).
- **Preserve ranking URLs** (`seo/legacy-seo-map.md`). Don't rename traffic-earning pages.
- **Schema on every page** (Service / FAQPage / HowTo / Article / LocalBusiness / Breadcrumb / Project).
- **One design system.** Steel-blue brand + charcoal + orange CTAs. Don't reintroduce navy or sky-blue. Reuse the components.
- **Keep the build green**, then **push to `main`** — it auto-deploys to Vercel. Commit messages end with the Co-Authored-By trailer.
- **v1 only:** no client logins, no R2, no Stripe.

---

## 10. Setup the founder still needs to do

- ✅ **Migration `0015_page_views.sql` APPLIED to Sydney 2026-09-11** — pasted into the SQL editor through the app's Browser pane while Rhys was signed in (the Management API token and the MCP token are BOTH expired, so that pane is currently the only write path to the database; Rhys signs in, the session runs the SQL via `monaco.editor.getModels()[0].setValue()` + Run). "Success. No rows returned" and `page_views` reachable through PostgREST straight after.
- ⚠️⚠️ **`0022_invited_only_roles.sql` IS APPLIED and it BROKE EVERY INVITE; `0023_invite_role_on_invited_at.sql` is WRITTEN and NOT YET APPLIED (2026-09-23).** 0022 honours the invite metadata only when `auth.users.invited_at` is set — but GoTrue INSERTS the user first and sets `invited_at` in a follow-up UPDATE (Martin: created 00:54:33, invited_at 00:54:43), so at insert time it is always NULL and every invited person landed as `client_member`: invisible on `/admin/staff` (staff roles only) and bounced to `/staff/no-access` when they clicked the link. Found when sam@ausdilaps.com.au (metadata `staff` / `[reports]`) came through as client_member and Rhys reported "no pending invite and she didn't get anything" — she HAD got it and signed in 62 s after the resend. Three-layer fix: `inviteStaff()` writes the role straight after `inviteUserByEmail()` returns; `listStaff()` runs `repairStuckInvites()` (invited_at set + staff metadata + still client_member → apply) so opening the page fixes anyone already caught; and 0023 adds an `after update of invited_at` trigger plus the same repair as SQL. All three guard on `role = 'client_member'`, so nothing can demote an edited role, and a self-signup never has `invited_at`, so 0022's protection stands. Since 2026-10-08 `listStaff()` reads auth users and profiles (client_member included) in ONE `Promise.all` and works out who is stuck in JS, so a normal load issues ZERO updates (it was ~9 sequential no-op UPDATEs, ~600ms, on every Staff tab render); the guarded updates run only for someone actually stuck, and the repaired row is patched in so they show on that same load. The 0022 note used to say "Invites are unaffected either way" — wrong.
- ⚠️ **Turnstile keys are NOT SET on Vercel (2026-10-12)** — the form runs on the honeypot + junk filter until they are. Cloudflare dashboard → Turnstile → Add widget (hostnames `ausdilaps.com.au`, `ausdilaps.vercel.app`; mode Managed) → set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` on Production (and Preview) → redeploy (the site key is baked in at build). Set BOTH or neither: site key without secret = the form 503s. Locally, `.claude/launch.json` → `dev-turnstile-test` runs with Cloudflare's always-pass test keys.
- ⚠️ **`0030_pagespeed_scores.sql` is WRITTEN and NOT YET APPLIED** (2026-10-08) — until it is, /admin Site health reads "Lab scores unavailable — Apply migration 0030" and the nightly `/api/pagespeed` cron returns 500. After pasting it (it ends in `notify pgrst`), press Run on `/api/pagespeed` under Vercel → Settings → Cron Jobs for the first scores.
- ⚠️ **`0026_crack_blast_scores.sql` is WRITTEN and NOT YET APPLIED** (2026-09-29) — until it is, CrackBlast plays fine but its leaderboard reads "Could not load the leaderboard." and no run is saved.
- ⚠️ **`0025_transcription_nightly.sql` is applied in its FIRST form only** (checked against Sydney 2026-10-06): the tables exist and carry rows, but `transcription_nightly_folders.notes_files` does NOT — so the log route runs its fallback select and a job folder holding only written notes (`No changes noted.txt`) still reads as a MISSING recording. Re-paste `0025` (idempotent — it ends in `alter table … add column if not exists notes_files`), then `notify pgrst, 'reload schema';`.
- ⚠️ **`0024_page_view_rendered.sql` is WRITTEN and NOT YET APPLIED** (2026-09-23) — `page_views.rendered`, set by a paint beacon, so the samples tile stops counting headless fetches. ⚠️ **Until it is pasted the tile reads 0 samples viewed**: `markRendered()` warns once and returns, so no view is ever confirmed, while the unlock and click figures carry on unaffected. It understates rather than overstates, deliberately, but apply it promptly. Measured before building it (26 "visitors" / 9 days): ~20 were single-view, zero-second, no-referrer fetches on scattered old Chrome versions and three desktop Linux machines, and `web_vitals` showed four loads inside 40ms of each other (ttfb 14-16ms) repeating on five days with no paint recorded. They send a desktop-Chrome UA AND `sec-fetch-dest: document`, so no header check catches them — a First Contentful Paint does, because producing one means actually rendering. Unrendered rows are KEPT and reported ("N automated ignored" on the tile, a "not rendered" badge per visitor); views predating the first confirmed paint count as *unmeasured*, never automated.
- ⚠️ **`0021_samples_visitors.sql` is WRITTEN and NOT YET APPLIED** (2026-09-18) — until it is, samples views are counted as before but `/admin/samples` shows nothing and clicks are not recorded.
- ✅ **`0020_tool_usage_user.sql` IS APPLIED** (inferred 2026-09-23: `/admin/staff` shows attributed tool uses, which needs the column).
- ✅ **Migration `0016_web_vitals.sql` IS APPLIED** (verified 2026-09-14 by reading the table back). ⚠️ **`0017_lead_ack_emailed.sql` is WRITTEN and NOT YET APPLIED** — until it is, the enquiries list draws a muted dash instead of a tick for the enquirer acknowledgement, and `/api/quote` fails to write `ack_emailed`. The info@ tick works either way.
- **Migrations `0001`–`0014` are all applied to Sydney** (verified 2026-09-08 by querying each table directly, since the MCP token is expired and the `schema_migrations` ledger is not maintained). Nothing outstanding. See §3 for how to apply the next one. ⚠️ **Verify before repeating anything in this section** — every item below was stale on 2026-09-08 and a session told Rhys to action work he had already done. `npx vercel env ls production` lists what is really set.
- ✅ **`NEXT_PUBLIC_SITE_URL` is SET on Vercel** (production) and is now **`https://ausdilaps.com.au`** — changed at the 2026-09-10 cutover, together with Supabase Auth → URL Configuration → Site URL. Every staff INVITE is built from it (self-service magic links use the browser origin, so they are unaffected). The old warning to keep it on the vercel.app origin no longer applies: the domain serves this site.
- ✅ **`RESEND_API_KEY` is SET on Vercel** (production), so quote acknowledgement emails send.
- ⚠️ **`GOOGLE_MAPS_API_KEY` must have Application restrictions set to NONE.** Adding an HTTP-referrer ("Websites") restriction to it silently kills Places, Geocoding and Directions — server-side calls send no `Referer`, and those three APIs reject a referrer-restricted key outright (`API keys with referer restrictions cannot be used with this API` / `Requests from referer <empty> are blocked`). This happened on 2026-09-07 while the browser key was being set up: the address search stopped auto-filling, and with it the cadastre lookup, road tracing, Property Sizing and Road Survey Estimator. **Static Maps keeps working**, which is what makes it look like only the address box is broken. Referrer restrictions belong ONLY on `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`; this key is protected by never being published plus per-API quota caps.
- ✅ **`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` is SET** (both `.env.local` and Vercel production) and authorises `localhost:3210` as well as the listed origins. Kept here for the key's CONSTRAINTS, which still apply if it is ever reissued. Neither map renders without it. A **NEW, SEPARATE** key from `GOOGLE_MAPS_API_KEY`; do not reuse that one, it carries Geocoding/Directions/Static Maps quota and Maps JS exposes its key in the client bundle. In Google Cloud Console → Credentials → Create credentials → API key, then on that key:
  1. **Enable the Maps JavaScript API** on the project (APIs & Services → Library). No existing tool uses Maps JS — everything else on the key is Static Maps / Places / Geocoding / Directions — so this most likely needs turning on.
  2. **Application restrictions → Websites**, listing exactly `https://ausdilaps.vercel.app/*`, `https://ausdilaps.com.au/*`, `http://localhost:3000/*`. ⚠️ Do NOT add `https://*.vercel.app/*` — that lets anyone's deployment spend the quota.
  3. **API restrictions → Maps JavaScript API only.**
  4. **A daily quota cap** (Maps JavaScript API → Quotas, ~500/day). A `Referer` header is forgeable, so the cap — not the referrer list — is the real cost ceiling.
  Cost: Dynamic Maps is 10,000 free map loads/month then ~US$7/1,000, where a "load" is one map instantiation and all panning/zooming/tiles are included. Internal staff use is nowhere near the free tier.
- ✅ **Street View Static API is ENABLED** (2026-09-08) and needed no key change — `GOOGLE_MAPS_API_KEY` carries no API restriction list, so it picked the new API up as-is. Only the free metadata endpoint is ever called.
- **Tender Watch setup:** `CRON_SECRET` (min 32 chars — the scan route 503s without it), `TENDER_AUSTENDER_FEED_URL` (verify by hand in a browser, then test from a deployed preview — gov hosts 403 datacenter IPs), `TENDER_NOTIFY_EMAIL`. Sending is manual, so there is nothing to leave switched off. Phase 2 needs an Entra app registration scoped with **RBAC for Applications** (`New-ServicePrincipal` + `New-ManagementScope`; `New-ApplicationAccessPolicy` is the superseded path) — full list in `docs/tender-watch.md`.
- **Staff portal setup** (Supabase Auth URLs, disable signups, Resend SMTP, the Invite email template, then `node scripts/invite-admin.mjs <email>`): the full ordered list is in `docs/staff-portal.md`.
- **Env vars** (`.env.local` locally + Vercel → Settings → Environment Variables) — see `.env.local.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ADMIN_EMAIL=info@ausdilaps.com.au`, `NEXT_PUBLIC_SITE_URL=https://ausdilaps.com.au`, `SF_*` (Salesforce, when ready), `NEXT_PUBLIC_GA4_ID=G-81JV6BQ2R5`. The marketing site renders without any of these; the form/admin need them.

---

## 11. Who you're working with

**Hemi Hara** (Pixel Matrix Group; AusDilaps sits under Urban Pulse). Works fast and iteratively, reviews on the live Vercel preview. Wants: **direct, no jargon, real data, ship and show.** Diagnosis before prescription; challenge assumptions; no filler. The whole point is the **expansive, authority-building content + forms** — that's the key work; the future portal is a separate system.
