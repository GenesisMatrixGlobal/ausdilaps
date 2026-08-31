# AusDilaps — Project Brief & Big-Build Plan

**Read this first. It is the full context for the AusDilaps website. Paste it into a fresh session or rely on it auto-loading. Build from the REAL content referenced here — never invent stats, claims, or projects.**

---

## 1. What this is

A ground-up rebuild of **ausdilaps.com.au** for **AusDilaps — Specialist Building Inspections**, Australia's specialist **dilapidation (building condition) report** firm. ~$5M revenue, family-owned, 15 years, team <50. Legal entity **Urban Pulse Strategies Pty Ltd T/A AusDilaps**, ABN **82 650 700 226**, Albany Creek / Aspley QLD, Australia-wide.

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

**Positioning line to build around:** *AusDilaps is the Tier 1 dilapidation specialist Australian contractors and government agencies trust when a damage claim has to be defensible, not just delivered.* (StoryBrand: the customer — a project manager / contracts admin / council risk officer — is the hero; we are the guide with Tier-1 proof + chartered engineers.)

---

## 3. Current state (already built & LIVE — don't redo)

- **Repo (`origin`, Vercel-connected):** `github.com/GenesisMatrixGlobal/ausdilaps` — **every push to `main` auto-deploys** to Vercel (`ausdilaps.vercel.app`). Secondary remotes kept locally: `ausdilaps-master` (`AusDilaps-Master/ausdilaps`, private, the previous canonical) and `old-mypixel` (`MyPixelStrategy/ausdilaps`, dead).
- **Pages live (Phases 1–7 BUILT — don't redo):**
  - `/` homepage, `/faq`, `/styleguide`.
  - **Pillar + locations + samples:** `/dilapidation-reports` (Service + HowTo + FAQPage), `/dilapidation-reports/[location]` (6 cities sydney/brisbane/melbourne/wollongong/canberra/perth — legacy nested slug `dilapidation-reports-<city>`, per-city LocalBusiness + Service + HowTo + FAQ), `/dilapidation-reports/samples`.
  - **Services (10):** `/our-services` index + `/our-services/[slug]` (commercial/residential/industrial dilapidation, structural-engineering, aerial-drone-surveys, noise-and-vibration-monitoring-services, defect-origin-assessments-doa, highways-roads, structural-integrity-assessments, defect-comparison-assessments). Data: `data/services.ts`.
  - **Portfolio (24):** `/portfolio` filterable index + `/portfolio/[slug]` — 21 real projects (verbatim legacy slugs) + 3 case studies. Data: `data/portfolio.ts` (+ `data/case-studies.ts`). Imagery in `public/portfolio/` + `public/projects/`.
  - **Insights (MDX):** `/insights` + `/insights/[slug]` — `content/insights/*.mdx` via `lib/insights.ts` (gray-matter + next-mdx-remote/rsc). 3 articles live; tunnel/Brisbane-2032/natural-events still TODO (need grounded research).
  - **Lead engine:** `/quote` form + `/api/quote` (zod `lib/leads.ts` + tier classify, honeypot, env-gated Turnstile, Supabase insert, Resend admin+ack, Salesforce upsert `lib/salesforce.ts` behind `SF_SYNC_ENABLED`, `LEAD_TEST_MODE`). All CTAs → `/quote` via `QUOTE_HREF`.
  - **SEO:** `app/sitemap.ts` (51 urls, data-driven), `app/robots.ts`, `app/llms.txt/route.ts`, `data/redirects.ts` → `next.config.ts redirects()`, GA4 env-gated in `app/layout.tsx`.
- **Shared components** (`components/marketing/`): `breadcrumbs`, `page-hero`, `content-section` (data-driven bands), `faq-accordion` (FaqList/FaqSection), `cta-band`, `related-links`, `portfolio-card`/`portfolio-grid`, `insights-grid`, `mobile-nav`, `quote-form`. Schema builders added to `lib/seo.ts`: `localBusinessForCity`, `projectSchema`, `articleSchema`, `itemListSchema`.
- **Design system + brand** implemented (see §5). Real logo wired into header/footer. Mobile nav added.
- **Supabase project:** ref **`crqfxdywgxtxgpwrojyc`** — **"AusDilaps - Sydney", `ap-southeast-2`. THIS IS PRODUCTION.** All migrations `0001`–`0009` are applied (verified 2026-08-27 against it directly). Note `supabase_migrations.schema_migrations` is not maintained — migrations are applied as raw SQL and never write that ledger, so the schema is the truth, not the ledger.
- ⚠️ **`zjgntkfzgtrqkklglhpo` (Tokyo, `ap-northeast-1`) is the OLD project.** It was production until the 2026-08-26 move to Sydney and is kept only as a rollback path. An earlier version of this file called it "the one production uses" — that is now wrong, and a session nearly applied migration `0009` to it. **Check the ref before running anything.**
- ⚠️ **The two projects are on SEPARATE Supabase accounts.** A personal access token can only ever see the projects its own account owns, so the Tokyo token returns "account does not have the necessary privileges" against Sydney and vice versa. That is not a permissions setting you can fix — you need a token made on the account that owns "AusDilaps - Sydney".
- **Supabase MCP works.** `.mcp.json` (gitignored) pins `--project-ref=crqfxdywgxtxgpwrojyc` `--read-only`. Read-only, so migrations go via the Management API.
- **Applying a migration** (`npm run migrate` still does not work — the `DATABASE_URL` in `.env.local` is the old Tokyo host and password). POST the file to `https://api.supabase.com/v1/projects/crqfxdywgxtxgpwrojyc/database/query` with the token in `.env.local` as `SUPABASE_NEW_ACCESS_TOKEN`. Use curl, not python — Cloudflare 1010s unrecognised user-agents.
  - **Then run `notify pgrst, 'reload schema';`** or PostgREST keeps serving its cached schema and every new table reads as *"Could not find the table in the schema cache"*.
  - **Idempotency trap:** columns added inside `create table if not exists` never land on a database that already has the table. Put new columns in BOTH the create and an explicit `alter table ... add column if not exists`.
  - **`on conflict` cannot target a partial unique index.** PostgREST has no way to send the predicate, so use a plain unique index (NULLs compare as distinct, so partial-style behaviour still holds).
- ⚠️ **`.env.local` was pointing at Tokyo until 2026-08-27** and was silently testing against the retired database. It now points at Sydney; the old values are in `.env.local.bak-*`. If something reads as "table not found", check which project the env resolves to first — `createAdminClient()` prefers a bare `SUPABASE_URL` over `NEXT_PUBLIC_SUPABASE_URL`, which is what caused the post-migration "Invalid API key".
- ⚠️ **Local dev writes to PRODUCTION.** There is no separate dev database, so anything uploaded from localhost is a real row. Worth splitting before the team starts using the knowledge base.
- ❗ **`iiedgpurcsgakehrqzcr` is NOT an AusDilaps project.** It belongs to a separate, unrelated Supabase org. An earlier note here called it "a second, empty AusDilaps project" and said to delete one of the two — that was wrong, and acting on it would destroy unrelated work. Leave it alone.
- **Staff portal (BUILT — don't redo):** `/staff` = per-user magic-link auth, department-scoped. `/admin` = company admins only. See `docs/staff-portal.md`.
  - Five departments in `lib/departments.ts`: estimators, inspectors, projects, reports, accounts (labelled "Admin & Accounts" — the old separate `office` department was merged into it). Stored as `profiles.departments text[]`; `admin`/`superadmin` implicitly get all.
  - Auth surface is `lib/auth/session.ts` (`getStaffUser` / `requireStaff` / `requireDepartment` / `requireAdmin`). `proxy.ts` refreshes the Supabase session and does the coarse signed-in check; role/department checks live in the layouts.
  - `/staff/[department]` presents two tabs: **Tools** and **Training**, as parallel-route slots (`@tools` / `@training`) with `DepartmentPanes` hiding the inactive one. Both panes stay mounted, so toggling tabs never throws away what a tool was holding. `DepartmentTabs` remembers each pane's last URL — point the Tools tab back at the bare `/tools` list and the return trip unmounts the tool anyway, defeating the whole arrangement.
  - `/staff` redirects a non-admin with exactly one department straight to it. Admins keep the list.
  - **Tool registry** `lib/tools/registry.ts` — tools are department-agnostic components in `components/tools/*`. Surfacing a tool to another department = adding a slug to its `departments` array. Never copy a tool. Each tool has a permanent `code` (SMK, PSZ, RSE, TDW, FPL, KML) for referring to it in conversation — **never renumber or re-letter one**, it would silently invalidate every past discussion.
  - **Training** = MDX in `content/training/<department>/*.mdx` via `lib/training.ts` (mirrors `lib/insights.ts`).
  - `/admin/staff` invites staff (Supabase `inviteUserByEmail` + the `0005` `auth.users` trigger) and assigns departments, via server actions that each re-check `requireAdmin()`.
- **Tender Watch (BUILT — don't redo):** the nightly tender pipeline. `/staff/accounts/tools/tender-watch` (no `/admin` route — admins reach it there and get the operator panels via the `isAdmin` flag). See `docs/tender-watch.md`.
  - **Not a scraper.** AU tender portals mostly offer email alerts, not feeds (AusTender's ATM RSS is the exception; tenders.gov.au and data.gov.au both 403 automated fetches). `tenders@` registers for every portal's alerts and the portals become the crawler. Two adapters, both built: `rss` (code-owned URLs, for SSRF reasons) and `email` (MS Graph, app-only).
  - **Email sources are DISCOVERED, not listed.** Every sender domain in the mailbox gets its own `tender_sources` row on the first night it emails — slug `email:<domain>`, no code change, no migration. `discoverMailboxSources()` runs before the source list is built, because a domain with no row would otherwise never be fetched.
  - ⚠️ **`alert_on_quiet` defaults FALSE and must stay that way.** Every direct client invitation is also a source, and `summary.ts` marks anything `critical` after 5 empty runs — alarms-on-by-default would paint the dashboard red inside a month and bury the portal that actually stopped sending. Failures are never opt-in.
  - **Parse-mode `auto` leans digest on purpose.** A 30-tender digest read as one email loses 29 silently; a single read as a digest just makes junk the classifier rejects. The zero-link fallback in `parseDigest()` is what makes that bias safe — don't remove it.
  - `npm run check:tenders` (pure, no env) and `npm run check:sources` (writes throwaway rows to the real DB).
  - Vercel Cron at `0 10 * * *` UTC = **8pm Brisbane year-round** (QLD has no DST). First `vercel.json` in the repo; a 9am health check runs alongside it.
  - Two phases, both resumable off partial indexes: fetch+persist (raw stored *before* parsing, so a format change is replayable) then classify+forward. No retry queue — tomorrow's run is the retry.
  - `lib/tenders/*`, migration `0006`, `lib/html.ts` (hardened escaping), `lib/auth/shared-secret.ts` (fail-closed cron gate).
  - The tool is a **server** component (`index.tsx` loads, `view.tsx` renders) — unlike the other tools, because a dashboard must show state on open.
  - ⚠️ `tender_upsert_item`'s `on conflict do update` refreshes only source-owned fields. Widening it re-classifies and re-emails the whole back-catalogue nightly.
  - Ships in **shadow mode** (`TENDER_FORWARD_ENABLED=false`) — runs and classifies, sends nothing, for the first week.

- **Knowledge base (BUILT — ingest + keyword search):** the corpus behind the department search bar. Migrations `0009`/`0010`, `lib/knowledge/*`, `/staff/<dept>/training/manage`, search bar on `/staff/<dept>/training`.
  - **The unit is a CHUNK, not a file.** A 90-minute video is a useless result; "14:22 — ring the subject lot first" is the product. Every chunk stores an `anchor` (prose) or `start_seconds` (transcript) to deep-link back.
  - `lib/slug.ts` is the contract between `components/marketing/markdown.tsx` (which puts ids on headings) and `lib/knowledge/chunk.ts` (which stores them as anchors). **Change the slug rule in one place or every citation link silently lands at the top of the page.**
  - `knowledge_sources.body` holds the extracted text as the source of truth, so the chunker can be improved and everything re-chunked without anyone re-uploading.
  - **Reads are scoped by RLS, not app code** — retrieval must use the user-scoped client (`lib/supabase/server.ts`). Uses `is_staff()`, NOT `is_internal()`: the latter is admin-only and made the whole base invisible to ordinary staff.
  - `profiles.can_manage_knowledge` lets a department lead upload without being an admin. Publishing needs membership of EVERY department tagged on the content; company-wide (`departments = '{}'`) is admins only.
  - `npm run index:training` indexes `content/training/**/*.mdx` into the same corpus, and **runs automatically on every production deploy** via the `postbuild` hook in `package.json`. Adding a module is now just committing the `.mdx`.
    - The hook is `--on-deploy`, which differs from a manual run deliberately: it **only runs when `VERCEL_ENV=production`** (one Supabase project, no dev database — otherwise every local `npm run build` and every branch preview would write its own copy into live search), it **never fails the build** (a module that won't index is not a reason to stop shipping the site), and it **skips modules whose stored `body` is unchanged**, so a deploy that touched no training content does no writes.
    - A manual `npm run index:training` always re-indexes everything — that's what to run after changing the chunker (`lib/knowledge/chunk.ts`), which is exactly why `body` is stored.
    - Both modes **prune**: delete a module or flip it to `draft: true` and its knowledge source goes with it. Without that, search keeps confidently citing a page that 404s. Pruning only touches `kind='training'` rows and is scoped to the departments in the run, so `-- reports` can't delete another department's modules.
  - **Retrieval is BUILT** (`0010`, `lib/knowledge/retrieve.ts`, `components/staff/knowledge-search.tsx`): Postgres FTS, no embeddings, no model, no per-query cost. `search_knowledge()` is **`security invoker`** — RLS is the only thing scoping this corpus, and the `dept` argument is a second filter, not a substitute. Verified: a reports-only account reading `knowledge_chunks` directly gets zero rows.
    - `0010` also fixed two things that made naive FTS useless: source **titles** weren't in any search vector, and `websearch_to_tsquery` ANDs every term so one unmatched word returned nothing (`or_query()` widens it; ranking still floats full matches).
    - Snippets come back with `«match»` markers, not `<mark>` — `ts_headline` doesn't escape source text, so HTML would let an uploaded document inject markup. The client builds its own `<mark>`.
    - `components/staff/scroll-to-hash.tsx` is what makes `#heading` citations land on the heading; the browser resolves a hash before streamed content exists and silently gives up at the top of the page.
  - **Uploads are browsable** — `/staff/<dept>/training` lists them beside the MDX modules, each with its own page at `/staff/<dept>/training/knowledge/<id>`. Both the list and that page require the source to be tagged for the department in the URL (or company-wide): RLS is not enough on its own, because `has_department()` returns true for admins everywhere.
  - **Context + AI indexing (`0011`, `lib/knowledge/{ai,vision,summarise}.ts`).** The uploader answers three questions — what it covers / when you'd need it / what we call it internally — and those are fused with the document into an `ai_summary` + `ai_keywords`.
    - **Every PDF is read visually** by `claude-opus-5` (native PDF input — text AND images, no beta header). The transcription REPLACES `body`, so it is chunked and cited; that is only legitimate because it is a transcription, and the prompt forbids summarising. Proven on a PDF with **zero** extractable text: it produced headings, described where the buttons were, and read the values inside the screenshots.
    - **`ai_summary`/`ai_keywords` are SOURCE-level and never enter `knowledge_chunks`.** A chunk is what gets quoted back as the document's own words; a summary is the model's reading of it. Putting context into chunks would also make every chunk of a document match equally and destroy the ranking that picks the right passage.
    - `0011` weights the source vector with `setweight`: **A** title, **B** summary + ai_summary, **C** context + ai_keywords. Replaces 0010's repeat-the-title-twice hack, which does not survive fields of wildly different lengths.
    - ⚠️ `ai_keywords` is `text`, not `text[]` — `array_to_string()` is `STABLE`, so Postgres rejects it inside a generated column.
    - **Cost is one-time per document.** Search stays pure FTS at $0.00, and re-index re-chunks from the stored `body`, so vision is never re-paid. ~$0.15 per 10-page PDF.
    - **The AI path degrades, never blocks.** Every call returns a result object and is caught; a failed vision pass leaves the plain text extraction in place. Verified in the wild — a vision call 400'd and the row still indexed cleanly.
    - `ai_summary_edited` stops a re-index overwriting a human correction. Clearing the summary hands it back to the model.
  - **NOT built: the AI answer layer.** Deliberate — the corpus is tiny, and an LLM answer over a thin corpus is worse than an honest empty result. Add it once there's real volume. The Phase 4 pgvector migration is written in a comment in `0009`; triggers are ~1,500 chunks or a tail of should-have-matched misses in `knowledge_queries` (now being logged).
  - ⚠️ **`STAFF_PREVIEW=1` fakes the app user but NOT a Supabase session**, so RLS sees an anonymous caller and search returns nothing. It looks like an empty corpus, not an auth problem. Sign in properly to test retrieval.
  - The old shared `ADMIN_ACCESS_PASSWORD` gate is **gone** (`lib/auth/admin-session.ts` and `/api/admin/login` deleted). The per-tool `*_ALLOW_UNAUTHED` env hatches are now **dev-only** — they used to leave those API routes open in production.
- **Pre-cutover task:** `/dilapidation-reports/samples` links the LIVE WP sample PDFs (too heavy to commit; no R2 in v1) — must be re-hosted (Supabase Storage or compressed/committed) before the WP site comes down. See `seo/content-backlog.md`.
- **Build is green.** Always keep it that way: `npm run build`.

---

## 4. Stack & conventions

- **Next.js 16.2.4 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 · shadcn/ui (style `base-nova`, neutral)**. Mirrors the sibling project `Sigma Sync/web`.
- **Flat root, no `src/`.** Path alias `@/*` → repo root.
- Route group `app/(marketing)/` wraps public pages with `SiteHeader` + `SiteFooter`.
- **Supabase:** `@supabase/ssr` — `lib/supabase/{server,client,admin}.ts` (three-client pattern). Service-role (`admin.ts`) is server-only.
- **Email:** Resend. **CRM:** Salesforce (behind `SF_SYNC_ENABLED`). **No R2, no Stripe** in v1.
- **Content data** in `data/*.ts` (structured) and (future) `content/insights/*.mdx` (editorial).
- **SEO:** `lib/seo.ts` (schema builders) + `components/seo/json-ld.tsx` (`<JsonLd>` injector). Site-wide Organization + LocalBusiness in `app/layout.tsx`.
- Run: `npm run dev` (localhost:3000) · `npm run build` · `npm run lint`.

---

## 5. Brand & design system

**Anchor = the logo** (`public/logo/ad-logo.png`, white version `ad-logo-white.png`). Steel-blue towers + "DILAPS"; charcoal "AUS" + "Specialist Building Inspections" tagline.

**Tri-colour palette** (tokens in `app/globals.css`):
- **Steel blue `#46688a`** — the brand (eyebrows, rules, links, accents). Tokens: `ad-steel` / `ad-accent` / `ad-blue`, light `ad-steel-light #6d90b4`.
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

- **`~/Documents/VSCode/Reference Files/ausdilaps/`** — external drop zone for source material (capability statements, competitor research, vendor docs, briefs, data exports, large files); see its `CLAUDE.md` for an index. Lives outside this repo (not git-tracked).
- **`lib/site.ts`** — SITE (ABN, contact, AS 4349.0), STATS (1,000+ surveys/qtr · 1M+ photos/yr · 1,300+ hrs/mo · 600+ work orders/mo), SERVICES (Dilapidation flagship + SIA + DOA + DCA), CAPTURE_METHODS, PROCESS (the real **6-step methodology**), TEAM (Mike Burford CEO, Rhys Morgan GM, Kylie Crosson, Niro Rudrakumar, Jessica Lebbos, Martin Weng), TIER1_PROJECTS.
- **`data/faq.ts`** — the real FAQ (Dilapidation, Structural, BASIX, NatHERS), harvested verbatim from the live site.
- **`data/case-studies.ts`** — 3 real case studies with values: Main South Road Duplication **$1.1bn**, Ipswich Hospital **$710M**, Glenrowan Solar Farm **$170M** (client, location, metrics).
- **`seo/legacy-seo-map.md`** — the live ranking URLs to PRESERVE + keyword clusters (the migration map).
- **`seo/content-backlog.md`** — future content targets (Sydney/Melbourne tunnels, Brisbane 2032, natural events, advocacy).
- **The live site `ausdilaps.com.au`** — harvest more page copy with WebFetch (verbatim) as you build each service/location/project page.
- **The FY25/26 Capability Statement** (`~/Downloads/AusDilaps Capability Statement FY25-26.pdf`) — stats, team, methodology, services (SIA/DOA/DCA/DCA), case studies, "Acknowledgement of Country", "Supporting Women in the Workplace", green mission. Re-read for any service/about/methodology content.
- **WP backup** `20260616-AusDilaps-WordPress/wp-content/uploads/` — real project & service imagery (read-only; copy/downscale into `public/`).

**Services taxonomy (lead with dilapidation):** Dilapidation Reports (Commercial / Residential / Industrial) · Structural Integrity Assessments (SIA) · Defect Origin Assessments (DOA) · Defect Comparison Assessments (DCA) · Structural Engineering · Aerial Drone Surveys · Noise & Vibration Monitoring · Highways & Roads · BASIX · NatHERS. Capture methods (frame under dilapidation): photography, roadway video, drone, LiDAR, point cloud / 3D model, culvert & pipe, GPS/georeferenced.

**22 portfolio projects** (preserve `/portfolio/<slug>`): Queens Wharf, NorthConnex, Brisbane Airport, North West Rail Link, Barangaroo South, Mona Vale Road Upgrade, Port Botany Bulk Liquids Berth, The Northern Road Upgrade, WestConnex, Blacktown / Northern Beaches / Canberra hospitals, HMAS facilities, Australian War Memorial, Zig Zag Railway, Epping–Thornleigh, B-Line, TfNSW Station Refresh, Adina/Four Seasons/Circular Quay hotels, Dapto Bridge + more (see WP backup).

---

## 8. The big build plan

Build in this order. Each page: real content, full JSON-LD, a CTA to the quote form, mobile-friendly, build green, push (auto-deploys).

**Phase 1 — Service depth** (preserve live URLs `/our-services/<slug>` per `seo/legacy-seo-map.md`; lead with dilapidation):
`/our-services/commercial-dilapidation-reports`, `/our-services/residential-dilapidation-reports`, industrial, `/our-services/structural-engineering`, `/our-services/aerial-drone-surveys`, `/our-services/noise-and-vibration-monitoring-services`, `/our-services/defect-origin-assessments-doa`, `/our-services/highways-roads`, + SIA / DCA. Each: Service schema, inline FAQ (FAQPage), CTA. Wire the homepage service cards to these.

**Phase 2 — Pillar + locations + samples:** the `/dilapidation-reports` pillar exists; add `/dilapidation-reports/<sydney|brisbane|melbourne|perth|wollongong|canberra>` (per-location LocalBusiness schema, local copy) + `/dilapidation-reports/samples` (sample reports — ranks well).

**Phase 3 — Projects:** `/portfolio` filterable index + `/portfolio/[slug]` for all 22 (preserve slugs) + the 3 capability case studies. Project/CreativeWork schema. Copy imagery from the WP backup.

**Phase 4 — News / Insights engine** (a PRIMARY pillar): `/insights` (or `/news`) index + categories — **Natural events** (earthquakes/storms/cyclones/floods), **Major projects** (Brisbane 2032, Sydney/Melbourne tunnels), **Dilapidation knowledge** (what-is/cost/samples), **Standards & advocacy** (compulsory reporting / NSW model / AS 4349.0). MDX-first (`content/insights/*.mdx`, `gray-matter`), Article/NewsArticle schema, author + E-E-A-T. **Run a grounded research pass (verify facts/dates) before publishing tunnel/Brisbane-2032 content.** Migrate the BASIX post.

**Phase 5 — Lead engine:** rich quote form (Name, Role, Company, Email, Phone, Project name, Location, # adjoining properties, Required start date, DA condition / contract clause, Notes) → `/api/quote`: zod validate → honeypot (+ Turnstile env-gated, optional) → classify tier (role/company/#properties) → **Supabase insert (source of truth)** → Resend (admin notice to `info@ausdilaps.com.au` + enquirer ack) → **Salesforce upsert** (behind `SF_SYNC_ENABLED`). Failure-isolate each destination. Mirror `Sigma Sync/web/src/app/api/contact/route.ts`. Plus a capability-statement gated email-capture.

**Phase 6 — Staff portal + admin:** ✅ Supabase per-user auth, departments, tool registry, training, `/admin/staff` invites (see §3 and `docs/staff-portal.md`). **Still TODO:** `/admin/leads` table (statuses new→contacted→quoted→won/lost, export) + **news authoring UI** so the team publishes insights without a developer.

**Phase 7 — SEO/AEO/GEO finalisation:** `data/redirects.ts` → `next.config.ts redirects()` — **preserve live slugs; 301 only the dated blog post + PDF samples**. `app/sitemap.ts`, `app/robots.ts`, **`public/llms.txt`** (GEO), GA4 `G-81JV6BQ2R5`, validate every schema (Rich Results), Lighthouse > 90. Domain cutover (point `ausdilaps.com.au` at Vercel) ONLY after redirects are verified — the live site stays untouched until then.

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

- **Migrations `0001`–`0009` are all applied to Sydney.** Nothing outstanding. See §3 for how to apply the next one.
- **Add `NEXT_PUBLIC_SITE_URL=https://ausdilaps.vercel.app` to Vercel** — currently MISSING. Every staff INVITE is built from it (self-service magic links use the browser origin, so they are unaffected). ⚠️ Set it to the **vercel.app** origin, NOT `ausdilaps.com.au` — that domain still serves the old WordPress site, so invites pointed there 404. Change it at domain cutover, together with Supabase Auth → URL Configuration.
- **Add `RESEND_API_KEY` to Vercel** — also currently missing, so quote acknowledgement emails aren't sending.
- **Tender Watch setup:** `CRON_SECRET` (min 32 chars — the scan route 503s without it), `TENDER_AUSTENDER_FEED_URL` (verify by hand in a browser, then test from a deployed preview — gov hosts 403 datacenter IPs), `TENDER_NOTIFY_EMAIL`. Leave `TENDER_FORWARD_ENABLED=false` for week one. Phase 2 needs an Entra app registration scoped with `New-ApplicationAccessPolicy` — full list in `docs/tender-watch.md`.
- **Staff portal setup** (Supabase Auth URLs, disable signups, Resend SMTP, the Invite email template, then `node scripts/invite-admin.mjs <email>`): the full ordered list is in `docs/staff-portal.md`.
- **Env vars** (`.env.local` locally + Vercel → Settings → Environment Variables) — see `.env.local.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ADMIN_EMAIL=info@ausdilaps.com.au`, `NEXT_PUBLIC_SITE_URL=https://ausdilaps.com.au`, `SF_*` (Salesforce, when ready), `NEXT_PUBLIC_GA4_ID=G-81JV6BQ2R5`. The marketing site renders without any of these; the form/admin need them.

---

## 11. Who you're working with

**Hemi Hara** (Pixel Matrix Group; AusDilaps sits under Urban Pulse). Works fast and iteratively, reviews on the live Vercel preview. Wants: **direct, no jargon, real data, ship and show.** Diagnosis before prescription; challenge assumptions; no filler. The whole point is the **expansive, authority-building content + forms** — that's the key work; the future portal is a separate system.
