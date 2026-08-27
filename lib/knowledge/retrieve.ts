import "server-only";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatTimestamp } from "@/lib/knowledge/chunk";
import type { DepartmentSlug } from "@/lib/departments";

/** The read side of the knowledge base — Postgres full-text search, no embeddings.
 *
 *  Everything here goes through the USER-SCOPED client on purpose. Department
 *  scoping is enforced by RLS (0009), not by app code; swapping in the admin
 *  client would silently return every department's material to everyone and the
 *  result would look perfectly normal. See 0010 for the matching rules. */

export type KnowledgeKind = "document" | "video" | "training" | "note";

export type KnowledgeHit = {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  kind: KnowledgeKind;
  heading: string | null;
  /** Contains « » around matched terms — render with <Highlighted>, never as HTML. */
  snippet: string;
  /** Deep link into the material, or null when there's no page to open. */
  href: string | null;
  /** "▶ 14:42" for a transcript hit; null otherwise. */
  timestamp: string | null;
  /** True when an original file exists to download. */
  hasOriginal: boolean;
};

type Row = {
  chunk_id: string;
  source_id: string;
  heading: string | null;
  content: string;
  snippet: string | null;
  anchor: string | null;
  start_seconds: number | null;
  rank: number;
  source_title: string;
  source_kind: KnowledgeKind;
  source_url: string | null;
  source_storage_path: string | null;
};

/** Point a video URL at a moment. Uses the URL API rather than string-joining so
 *  a YouTube watch link (already carrying ?v=) doesn't end up with two `?`. */
function withTimestamp(url: string, seconds: number): string {
  try {
    const u = new URL(url, "https://placeholder.invalid");
    u.searchParams.set("t", String(Math.floor(seconds)));
    return u.host === "placeholder.invalid" ? `${u.pathname}${u.search}${u.hash}` : u.toString();
  } catch {
    return url;
  }
}

/** Chunks store markdown source, so a raw snippet shows its own syntax —
 *  "**A neighbour is missing**" instead of the sentence. A search result is a
 *  preview, not a document, so flatten the markers rather than render them.
 *  Leaves the « » match markers from ts_headline alone. */
function plainish(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")        // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")     // links → their text
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")        // code spans
    .replace(/(\*\*|__)(.*?)\1/g, "$2")           // bold
    .replace(/(?<![*\w])[*_](?!\s)([^*_]+?)[*_](?![*\w])/g, "$1") // emphasis
    // ts_headline cuts a fragment wherever the match is, which routinely lands
    // inside a **bold** run and leaves one half of the pair behind.
    .replace(/\*\*|__/g, "")                       // orphaned bold markers
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")           // heading marks
    .replace(/^\s{0,3}>\s?/gm, "")                // block quotes
    .replace(/^\s{0,3}[-*+]\s+/gm, "")            // bullets
    .replace(/\s*\n\s*/g, " ")                    // collapse to one line
    .replace(/\s{2,}/g, " ")
    .trim();
}

function hrefFor(row: Row): string | null {
  if (!row.source_url) return null;
  if (row.start_seconds !== null) return withTimestamp(row.source_url, row.start_seconds);
  // The anchor and the heading id on the rendered page come from the same
  // headingSlug() in lib/slug.ts. Don't recompute it here.
  if (row.anchor) return `${row.source_url}#${row.anchor}`;
  return row.source_url;
}

export async function searchKnowledge({
  query,
  department,
  limit = 20,
}: {
  query: string;
  department: DepartmentSlug;
  limit?: number;
}): Promise<KnowledgeHit[]> {
  const q = query.trim();
  // Don't spend a round trip proving that an empty box matches nothing.
  if (q.length < 2) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_knowledge", {
    q,
    dept: department,
    max_results: limit,
  });

  if (error) {
    console.error("[knowledge] search failed:", error.message);
    throw new Error("Search is unavailable right now.");
  }

  const rows = (data ?? []) as Row[];
  logQuery(q, department, rows.length);

  return rows.map((row) => ({
    chunkId: row.chunk_id,
    sourceId: row.source_id,
    sourceTitle: row.source_title,
    kind: row.source_kind,
    heading: row.heading,
    // ts_headline returns null when the query matched only the title; the opening
    // of the chunk is still the most useful thing to show.
    snippet: plainish(row.snippet ?? row.content),
    href: hrefFor(row),
    timestamp: row.start_seconds !== null ? `▶ ${formatTimestamp(row.start_seconds)}` : null,
    hasOriginal: Boolean(row.source_storage_path),
  }));
}

/** What people search for, and whether it found anything — the unanswered tail is
 *  the shopping list for what to upload next (and, later, the trigger for
 *  embeddings). knowledge_queries has RLS on with no INSERT policy, so this has to
 *  be the service-role client. Best-effort: logging must never break a search. */
function logQuery(query: string, department: DepartmentSlug, resultCount: number): void {
  after(async () => {
    try {
      await createAdminClient().from("knowledge_queries").insert({
        query,
        department,
        result_count: resultCount,
        answered: resultCount > 0,
      });
    } catch (e) {
      console.error("[knowledge] couldn't log query:", (e as Error).message);
    }
  });
}
