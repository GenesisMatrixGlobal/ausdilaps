# Staff portal — auth, departments, tools & training

`/staff` is the staff portal (magic-link sign-in, department-scoped). `/admin` is
company-admins only: invite staff, assign departments, view the tool registry.

There are **no client logins here** — a client portal remains a separate future system.

---

## How access works

| Role | Gets |
|---|---|
| `staff` | Only the departments ticked on their profile |
| `admin` / `superadmin` | Every department, plus `/admin` |
| `client_admin` / `client_member` | Nothing — dormant, reserved for the future client portal |

Departments are defined in [`lib/departments.ts`](../lib/departments.ts) and stored as a
`text[]` on `profiles.departments`. **Adding a department is one array entry — no migration**,
because code is the source of truth for valid slugs and `normaliseDepartments()` filters
anything unrecognised out of the database value.

Six departments ship: `estimators`, `inspectors`, `projects`, `reports`, `accounts`, `office`.
(`office` = "Admin & Office" — deliberately not `admin`, so `/staff/admin` never gets confused
with `/admin`.)

### The auth surface

Everything lives in [`lib/auth/session.ts`](../lib/auth/session.ts):

```ts
getStaffUser()              // StaffUser | null — fails closed
requireStaff(next?)         // else redirect to /staff/login?next=…
requireDepartment(slug)     // else /staff/no-access
requireAdmin()              // else /staff/no-access
canAccess(user, slug)       // admins ⇒ true for every department
```

`proxy.ts` does two things: refreshes the Supabase session on every `/staff` and `/admin`
request (without this, sessions die when the access token expires), and a coarse
"is anyone signed in?" check. Role and department checks happen in the route layouts.

Deactivating someone (`profiles.is_active = false`) revokes access on their **next request** —
`getStaffUser()` returns null for an inactive profile.

---

## Adding a tool

Tools are department-agnostic components behind a registry. The contract:

> A tool component knows nothing about departments, routes, or auth. It renders its own UI
> and nothing else — no `<main>`, no `<h1>`.

1. Write the component under `components/tools/<slug>/index.tsx`, exporting a named component.
2. Add an entry to `TOOLS` in [`lib/tools/registry.ts`](../lib/tools/registry.ts):

```ts
{
  slug: "my-tool",
  title: "My Tool",
  description: "One line, shown on the card and as the page subtitle.",
  departments: ["estimators", "projects"],
  Component: dynamic(() => import("@/components/tools/my-tool").then((m) => m.MyTool)),
}
```

That's it. It appears at `/staff/estimators/tools/my-tool` and
`/staff/projects/tools/my-tool`, served by the one generic
`app/staff/[department]/tools/[tool]/page.tsx`.

**To surface an existing tool to another department, add that department's slug to its
`departments` array.** One line, no new route, no duplicated component.

Shared tool UI goes in `components/tools/shared/` — currently `sync-to-salesforce.tsx`,
which takes an image *callback* rather than bytes so each tool decides which version to file
and nothing is rendered or billed until upload.

---

## Adding training

Training modules are markdown files in the repo:

```
content/training/<department>/<slug>.mdx
```

```markdown
---
title: "Producing a residential site markup"
summary: "One line for the card."
order: 1
duration: "8 min"
updated: "2026-08-24"
video: "https://www.loom.com/embed/…"     # optional
attachments:                              # optional
  - label: "Site markup SOP"
    href: "https://ausdilaps.app.box.com/…"
draft: true                               # optional — hides it
---

## Heading

Body text. **Bold** and [links](https://example.com) work.
```

Rendered by the existing `components/marketing/markdown.tsx` — a deliberately small subset:
h2/h3, paragraphs, lists, bold, links. No image syntax, no tables. Use `video` for a
walkthrough and `attachments` for anything living in Box.

Sorted by `order`, then title. A department with no folder gets a clean empty state.

**Authoring without a dev:** open the file on github.com, click the pencil, edit, commit.
Vercel deploys in about a minute.

---

## One-time setup

1. **Run the migrations** — `npm run migrate` (needs `DATABASE_URL` in `.env.local`; the value
   is `POSTGRES_URL_NON_POOLING` in Vercel, or Supabase → Project Settings → Database →
   Connection string → URI).
2. **Supabase → Auth → URL Configuration** — Site URL `https://ausdilaps.vercel.app`.
   Redirect allow-list:
   - `https://ausdilaps.vercel.app/staff/auth/callback`
   - `http://localhost:3000/staff/auth/callback`
3. **Supabase → Auth → Providers → Email** — turn **off** "Allow new users to sign up".
   (`shouldCreateUser: false` in the login form is the code-side belt; this is the braces.)
4. **Supabase → Auth → SMTP** — point at Resend, from `no-reply@ausdilaps.com.au`. **Not
   optional at team scale**: the built-in sender allows only a couple of emails an hour, so a
   round of invites will silently fail without it.
5. **Supabase → Auth → Email Templates → Invite user** — change the link to:

   ```
   {{ .SiteURL }}/staff/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/staff
   ```

   Invites are issued server-side, so there's no PKCE code verifier in the browser and the
   default `{{ .ConfirmationURL }}` lands with the token in the URL *fragment*, which a server
   route can't read. The magic-link template needs no change — those start in the browser and
   arrive as `?code=`.
6. **Bootstrap the first admin:**
   ```bash
   node scripts/invite-admin.mjs rhys.m@ausdilaps.com.au "Rhys Morgan"
   ```
   Click the emailed link, then invite everyone else from `/admin/staff`.
7. **After the team is in**, in Vercel: delete `ADMIN_ACCESS_PASSWORD` and set
   `PROPERTY_SIZING_ALLOW_UNAUTHED`, `KML_ROAD_TRACE_ALLOW_UNAUTHED` and
   `SURVEY_HEADING_UPLOADER_ALLOW_UNAUTHED` to `false`.

---

## Security notes

**The `*_ALLOW_UNAUTHED` env vars are now dev-only.** `isStaff()` used to check them *first*,
so with them set to `true` in production, `/api/property-sizing`, `/api/kml/site-markup` and
the road-trace routes were reachable by anyone on the internet — including the ones that spend
money on Google Maps and Anthropic calls. They're now ignored unless `NODE_ENV !== "production"`.

**`profiles` has no UPDATE policy.** Migration `0005` drops the `profiles self update` policy
from `0001`, which had a `USING` clause but no `WITH CHECK` — an authenticated user could have
updated their own row and set `role` to `superadmin`. All profile writes go through
service-role server actions in `/admin`.

**Server actions re-check auth.** `app/admin/staff/actions.ts` calls `requireAdmin()` in every
action. The `/admin` layout guard does not protect them — server actions are independently
reachable POST endpoints.

**Lock-out guards.** You can't deactivate or demote yourself, and no change is allowed that
would leave zero active admins.
