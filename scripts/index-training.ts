/**
 * Indexes the training modules that live in the repo into the knowledge base.
 *
 *   npm run index:training           # all departments
 *   npm run index:training -- reports
 *
 * Why this exists: content/training/**\/*.mdx is authored in git, but the search bar reads
 * knowledge_chunks. Without this, the modules people already rely on would be the one
 * thing the search couldn't find.
 *
 * Idempotent — each module upserts on source_ref, so re-running updates in place rather
 * than creating a second copy. Safe to run on every deploy.
 *
 * Deliberately does NOT import lib/knowledge/ingest.ts: that module is `server-only`,
 * which is a guard worth keeping. It talks to Supabase directly and reuses the pure
 * chunker instead.
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chunkMarkdown } from "../lib/knowledge/chunk";
import { getTrainingModules, getTrainingModule } from "../lib/training";
import { DEPARTMENT_SLUGS, isDepartmentSlug, type DepartmentSlug } from "../lib/departments";

// Same as scripts/migrate.mjs — dotenv's default is .env, which this repo doesn't use.
config({ path: ".env.local" });

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  console.error("Missing Supabase env. Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const db = createClient(url, key);

async function indexDepartment(department: DepartmentSlug) {
  const modules = getTrainingModules(department);
  if (modules.length === 0) {
    console.log(`  ${department}: no modules`);
    return;
  }

  for (const meta of modules) {
    const mod = getTrainingModule(department, meta.slug);
    if (!mod) continue;

    const sourceRef = `content/training/${department}/${meta.slug}.mdx`;
    const chunks = chunkMarkdown(mod.content);

    const { data, error } = await db
      .from("knowledge_sources")
      .upsert(
        {
          kind: "training",
          departments: [department],
          title: mod.title,
          summary: mod.summary ?? null,
          // Citations for a training module deep-link to the page it already has, not to
          // a knowledge-base copy of it — the module page is the better read.
          url: `/staff/${department}/training/${meta.slug}`,
          source_ref: sourceRef,
          is_published: true,
          body: mod.content,
          format: "markdown",
          indexed_at: null,
          index_error: null,
        },
        { onConflict: "source_ref", ignoreDuplicates: false }
      )
      .select("id")
      .single();

    if (error) {
      console.error(`  ${sourceRef}: ${error.message}`);
      continue;
    }

    const id = data.id as string;
    await db.from("knowledge_chunks").delete().eq("source_id", id);

    if (chunks.length > 0) {
      const { error: insErr } = await db.from("knowledge_chunks").insert(
        chunks.map((c) => ({
          source_id: id,
          ordinal: c.ordinal,
          heading: c.heading,
          content: c.content,
          start_seconds: c.startSeconds,
          anchor: c.anchor,
        }))
      );
      if (insErr) {
        await db.from("knowledge_sources").update({ index_error: insErr.message }).eq("id", id);
        console.error(`  ${sourceRef}: ${insErr.message}`);
        continue;
      }
    }

    await db
      .from("knowledge_sources")
      .update({ indexed_at: new Date().toISOString(), chunk_count: chunks.length, index_error: null })
      .eq("id", id);

    console.log(`  ${sourceRef} -> ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}`);
  }
}

async function main() {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const departments = requested.length > 0 ? requested : [...DEPARTMENT_SLUGS];

  const bad = departments.filter((d) => !isDepartmentSlug(d));
  if (bad.length > 0) {
    console.error(`Unknown department(s): ${bad.join(", ")}`);
    console.error(`Valid: ${DEPARTMENT_SLUGS.join(", ")}`);
    process.exit(1);
  }

  console.log(`Indexing training into ${url!.replace(/^https?:\/\//, "").split(".")[0]}…`);
  for (const d of departments as DepartmentSlug[]) await indexDepartment(d);
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
