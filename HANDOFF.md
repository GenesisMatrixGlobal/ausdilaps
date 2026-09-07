# AusDilaps — Session Handoff

**Read `CLAUDE.md` first** (full project brief + guardrails). This file is the live status + outstanding work as of this handoff. Hand-off target: another Claude in VS Code.

---

## TL;DR — where we are

The full marketing + lead + insights build (Phases 1–7 of the plan) is **built, green, and live** on the Vercel preview **https://ausdilaps.vercel.app** (auto-deploys on every push to `main`). Latest deploys verified: all page types return `200`. The live `ausdilaps.com.au` domain is **not** cut over yet (still the old WordPress site).

Stack: Next.js 16.2.4 (App Router, Turbopack) · React 19 · TS · Tailwind v4 · shadcn. Flat root, `@/*` alias. Run: `npm run dev` / `npm run build` / `npm run migrate`.

---

## What's live (all real content — no fabricated stats)

- **Home** `/`, **FAQ** `/faq`, **styleguide** `/styleguide`
- **Dilapidation pillar** `/dilapidation-reports` (Service + HowTo + FAQPage)
- **Locations (6)** `/dilapidation-reports/dilapidation-reports-<city>` — sydney, brisbane, melbourne, wollongong, canberra, perth (per-city LocalBusiness + Service + HowTo + FAQ; legacy nested slug preserved)
- **Samples** `/dilapidation-reports/samples` (catalogue → links live WP PDFs — see gap below)
- **Services (10)** `/our-services` + `/our-services/[slug]` — data in `data/services.ts`
- **Portfolio (24)** `/portfolio` (filterable) + `/portfolio/[slug]` — 21 projects + 3 case studies, `data/portfolio.ts` + `data/case-studies.ts`
- **Insights** `/insights` + `/insights/[slug]` — MDX in `content/insights/*.mdx`, 3 articles
- **Quote/lead form** `/quote` + `/api/quote`
- **SEO** `app/sitemap.ts` (data-driven), `app/robots.ts`, `app/llms.txt`, redirects in `data/redirects.ts` → `next.config.ts`, GA4 env-gated

### Architecture cheat-sheet
- Content lives in `data/*.ts` (services, locations, portfolio, case-studies, redirects) + `content/insights/*.mdx`.
- Shared UI in `components/marketing/`: `page-hero`, `content-section` (data-driven bands), `faq-accordion`, `cta-band`, `related-links`, `breadcrumbs`, `portfolio-card`/`portfolio-grid`, `insights-grid`, `mobile-nav`, `quote-form`, **`markdown.tsx`** (in-house MD renderer — see gotcha).
- Schema builders in `lib/seo.ts`. Lead logic in `lib/leads.ts` (zod + tier) + `lib/salesforce.ts`.

---

## Forms — migration status (answers "have we migrated them all?")

**The new site has ONE form: `/quote`** (`components/marketing/quote-form.tsx` → `/api/quote`). It deliberately **consolidates** the old WordPress forms (the old site used **WPForms** across `/contact-us/` and `/contact-us/consultation/`) into a single rich, tier-classifying lead form. So functionally the contact + consultation/quote forms are migrated into `/quote`.

- All "Request a Quote" CTAs site-wide → `/quote` (`QUOTE_HREF`).
- "Download Capability Statement" CTAs → the committed PDF `/public/AusDilaps-Capability-Statement-FY25-26.pdf` (`CAPABILITY_HREF`), opens new tab. (Was wrongly → `/quote`; fixed.)
- The brief's planned **capability-statement gated email-capture** form was **not** built — it's a direct download for now. (Optional future enhancement.)

`/api/quote` flow: zod validate → honeypot → Turnstile (gated) → tier classify → **Supabase insert (source of truth)** → Resend admin+ack → Salesforce upsert (gated). Every destination is failure-isolated; `LEAD_TEST_MODE` routes both emails to `ADMIN_EMAIL` and skips Salesforce.

---

## Env / integrations status

- **Supabase migration: RUN.** `supabase/migrations/0001_init.sql` applied (it's idempotent now). `leads` + dormant portal tables exist.
- **Supabase keys: in Vercel.** Using the NEW key format — publishable → `NEXT_PUBLIC_SUPABASE_ANON_KEY`, secret → `SUPABASE_SERVICE_ROLE_KEY`. So the form **saves leads on Vercel** (redeploy already triggered).
- **`.env.local` exists locally** (git-ignored) with known values filled; Supabase keys are **blank locally** (they live in Vercel), so the form won't persist if run purely locally without adding them.
- **Resend: NOT live yet.** Interim plan agreed: zero-domain `onboarding@resend.dev` sender, `ADMIN_EMAIL=info@pixelmatrix.com.au`, `LEAD_TEST_MODE=true`. **Waiting on the `RESEND_API_KEY`** (must be from a Resend account registered under info@pixelmatrix.com.au, because resend.dev only delivers to the account's own email). Until added, leads still save; no email is sent. At go-live: switch `RESEND_FROM_EMAIL` to a verified ausdilaps.com.au address, `ADMIN_EMAIL` → info@ausdilaps.com.au, `LEAD_TEST_MODE=false`.
- **GA4**: `NEXT_PUBLIC_GA4_ID=G-81JV6BQ2R5` (env-gated).
- `npm run migrate` runner exists (`scripts/migrate.mjs`, `pg` devDep) — needs `DATABASE_URL` in `.env.local` (Supabase → Settings → Database → Connection string → URI).

---

## Outstanding / not done (pick up here)

1. **Resend API key** → add to `.env.local` + Vercel; verify a test lead emails. (Blocked on the key.)
2. ~~**Sample-report PDFs**~~ — **DONE.** The samples page renders from Box, and the
   static WordPress fallback has been removed, so nothing on the site links the old
   origin any more. `/wp-content/uploads/*` also now redirects (see below).
3. **Legal pages NOT migrated:** old `/contact-us/privacy-policy/` and `/contact-us/terms-conditions/` have no equivalent. Add `/privacy-policy` + `/terms-conditions` pages and redirects. **Deliberately left unmapped** — pointing a privacy policy at the homepage reads as a soft 404 to Google and is worse than the 404. Needs real legal copy. Also a compliance gap: `/quote` collects personal data with no privacy policy to link.
4. ~~**`/contact-us/* ` redirects**~~ — **DONE** for `/contact-us`, `/contact-us/consultation` and `/contact-us/capability` (all → `/quote`). The two legal URLs are item 3.
5. **Insights backlog:** tunnel / Brisbane-2032 / natural-events articles need a **grounded research pass** before publishing (`seo/content-backlog.md`).
6. **Admin backend (Phase 6):** not built — Supabase auth (`profiles.role`), `proxy.ts` guard, `/admin` leads table + news authoring. Separate effort.
7. **Domain cutover (Phase 7 tail):** point `ausdilaps.com.au` at Vercel ONLY after redirects verified + sample PDFs re-hosted.

---

## Known gotchas (learned the hard way this session)

- **Do NOT reintroduce `next-mdx-remote`** — its build-time MDX compile passed local Turbopack builds but **broke Vercel's `next build`**. Articles render via the in-house `components/marketing/markdown.tsx` (headings/lists/bold/links). `.mdx` files are parsed for frontmatter via gray-matter; body is plain Markdown.
- **Redirect wildcards must not shadow `/public` asset paths.** A `/projects/:category` redirect once swallowed the hero images in `/public/projects/*.jpg`. Keep redirect sources specific.
- **Vercel env var changes need a redeploy** to take effect (push any commit, or Redeploy in the dashboard).
- **`fs` in client components** breaks Turbopack — keep `node:fs` modules (e.g. `lib/insights.ts`) server-only; client-safe helpers live in `lib/format.ts`.
- **Supabase new keys** (`sb_publishable_` / `sb_secret_`) are the anon / service-role replacements; `@supabase/supabase-js@2.105.3` supports them.
- Commit messages end with the `Co-Authored-By` trailer. Push to `main` = auto-deploy.

---

## Verify quickly
- `npm run build` (must stay green) · `npm run lint` · `npm run typecheck`
- Live smoke: `curl -s -o /dev/null -w "%{http_code}" https://ausdilaps.vercel.app/<path>`
- Deploy status: `gh api repos/MyPixelStrategy/ausdilaps/commits/main/status --jq '.statuses[]|select(.context=="Vercel")|.state'`
