# AusDilaps

Tier 1 dilapidation specialist — marketing site, qualified-lead engine, and secure client report portal.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Supabase (DB/auth/RLS) · Resend (email) · Cloudflare (Turnstile) · Salesforce (staff tools). Deploy: Vercel via GitHub.

The build plan lives at `~/.claude/plans/i-am-going-to-polymorphic-pretzel.md`.

## Getting started

```bash
cp .env.local.example .env.local   # then fill in credentials
npm install
npm run dev
```

## Notes

- `20260616-AusDilaps-WordPress/` is the old WordPress backup, kept locally as a read-only reference. It is git- and vercel-ignored and never ships.
- Design tokens are placeholders until the Construktion X Figma file is pulled via Dev Mode MCP.
