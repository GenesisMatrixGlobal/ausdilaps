# Dev setup & shared secrets

One source of truth for secrets lives in **Vercel**; each developer syncs it locally
with the Vercel CLI. No more hand-edited `.env.local` per person.

## One-time, per developer

```bash
npm i -g vercel                 # install the CLI
vercel login                    # sign in (browser) with your AusDilaps/MPS Vercel account
vercel link                     # link this folder to the "ausdilaps" Vercel project
vercel env pull .env.local      # download the shared secrets into .env.local
```

Re-run `vercel env pull .env.local` any time the team changes a secret.

## Adding / changing a shared secret (whoever has Vercel access)

Set it once for the team — either the dashboard (Project → Settings → Environment
Variables) or the CLI, then tell everyone to re-pull:

```bash
vercel env add ANTHROPIC_API_KEY production
vercel env add ANTHROPIC_API_KEY preview
vercel env add ANTHROPIC_API_KEY development
# ...then each dev: vercel env pull .env.local
```

## Variables this project needs

The full list is in [`.env.local.example`](../.env.local.example) (Supabase, Resend,
GA4, Salesforce, etc.) — most are already set in Vercel. The Bulk Property Sizing tool
adds two:

| Variable | Environments | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | all | Screenshot OCR (Claude vision). Paste-text still works without it. |
| `PROPERTY_SIZING_ALLOW_UNAUTHED` | **Development only** | Temporary staff-gate bypass for local dev. **Do NOT set it `true` in Production/Preview** — that would make `/admin/property-sizing` publicly usable. Leave it unset/false there until the Phase-6 admin login exists. |

## Notes

- `.env.local` is git-ignored — never commit it.
- The marketing site renders without any secrets; the quote form, `/admin`, and the
  sizing tool need them.
- Hosting stays on Vercel (auto-deploys on push to `main`). No AWS hosting is used.
