---
paths:
  - "lib/knowledge/**"
  - "lib/training.ts"
  - "lib/slug.ts"
  - "content/training/**"
  - "app/staff/**/training/**"
  - "components/staff/knowledge-search.tsx"
  - "components/staff/scroll-to-hash.tsx"
  - "components/marketing/markdown.tsx"
  - "scripts/index-training.ts"
---

# Knowledge base + training search

Moved verbatim from the root `CLAUDE.md` §3 on 2026-10-26 so it loads only when working on these files. Project-wide rules (Supabase refs, local dev writes to production, guardrails) stay in the root file.

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
    - **Cost is one-time per document.** Search stays pure FTS at $0.00, and re-index re-chunks from the stored `body`, so vision is never re-paid. ~$0.15 per 10-page PDF. ⚠️ **That was FALSE until 2026-09-18** — `indexSource()` re-ran the vision pass on every re-index, context save included (found by the security sweep as an uncapped-spend bug). It now skips vision when the row is already `format = 'markdown'` with a body; a PDF whose first pass failed stays `plain` and is retried. To force a fresh transcription, blank the body.
    - **The AI path degrades, never blocks.** Every call returns a result object and is caught; a failed vision pass leaves the plain text extraction in place. Verified in the wild — a vision call 400'd and the row still indexed cleanly.
    - `ai_summary_edited` stops a re-index overwriting a human correction. Clearing the summary hands it back to the model.
  - **NOT built: the AI answer layer.** Deliberate — the corpus is tiny, and an LLM answer over a thin corpus is worse than an honest empty result. Add it once there's real volume. The Phase 4 pgvector migration is written in a comment in `0009`; triggers are ~1,500 chunks or a tail of should-have-matched misses in `knowledge_queries` (now being logged).
  - ⚠️ **`STAFF_PREVIEW=1` fakes the app user but NOT a Supabase session**, so RLS sees an anonymous caller and search returns nothing. It looks like an empty corpus, not an auth problem. Sign in properly to test retrieval.
  - The old shared `ADMIN_ACCESS_PASSWORD` gate is **gone** (`lib/auth/admin-session.ts` and `/api/admin/login` deleted). The per-tool `*_ALLOW_UNAUTHED` env hatches are now **dev-only** — they used to leave those API routes open in production.
