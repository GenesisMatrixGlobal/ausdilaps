"use server";

import { isDepartmentSlug } from "@/lib/departments";
import { requireDepartment } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signedUrlFor } from "@/lib/knowledge/ingest";
import { searchKnowledge, type KnowledgeHit } from "@/lib/knowledge/retrieve";

// A server action, not an /api route: proxy.ts's matcher covers /staff/* but NOT
// /api/*, so an API route would have to re-establish the whole auth check itself.
// Actions are reachable from anywhere regardless, so each one re-checks access.

export type SearchResult =
  | { ok: true; hits: KnowledgeHit[]; query: string }
  | { ok: false; error: string };

export async function searchDepartmentKnowledge(
  department: string,
  query: string
): Promise<SearchResult> {
  if (!isDepartmentSlug(department)) return { ok: false, error: "Unknown department." };
  await requireDepartment(department, `/staff/${department}/training`);

  const q = query.trim().slice(0, 300);
  if (q.length < 2) return { ok: true, hits: [], query: q };

  try {
    return { ok: true, hits: await searchKnowledge({ query: q, department }), query: q };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Download link for an uploaded original found via search.
 *
 *  Deliberately not knowledgeDownloadUrl() from manage/actions.ts — that one gates
 *  on canEditKnowledge, which ordinary staff don't have. Reading is a different
 *  question from editing. RLS answers it: the select below runs on the user-scoped
 *  client, so a source they can't see comes back empty and there's nothing to sign. */
export async function knowledgeSourceFile(
  department: string,
  sourceId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!isDepartmentSlug(department)) return { ok: false, error: "Unknown department." };
  await requireDepartment(department, `/staff/${department}/training`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_sources")
    .select("storage_path")
    .eq("id", sourceId)
    .maybeSingle();

  if (error) return { ok: false, error: "Couldn't look that up." };
  if (!data?.storage_path) return { ok: false, error: "There's no original file for this one." };

  const url = await signedUrlFor(data.storage_path);
  return url ? { ok: true, url } : { ok: false, error: "Couldn't create a download link." };
}
