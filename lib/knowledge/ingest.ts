import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { chunkFor } from "./extract";
import { renderPdf } from "./vision";
import { summariseSource } from "./summarise";
import type { SourceFormat } from "./formats";
import type { DepartmentSlug } from "@/lib/departments";

/**
 * Writing knowledge into the database.
 *
 * Service-role throughout — matching 0001's design note. RLS on these tables is a READ
 * control (who can be answered from what); writes are gated in the server actions by
 * requireKnowledgeEditor() and canEditKnowledge(), which re-check for themselves because
 * a server action is a publicly reachable endpoint.
 *
 * The split that matters: saving a source is fast and synchronous, indexing it is neither.
 * A 60-page PDF is hundreds of chunks. So save returns immediately with indexed_at null
 * and the caller runs indexSource() inside after(), the way lib/auth/session.ts does for
 * last_seen_at. The row shows "Indexing…" until it lands.
 */

export const BUCKET = "knowledge";

/** Insert this many chunks per round trip. */
const CHUNK_BATCH = 200;

export type KnowledgeKind = "document" | "video" | "training" | "note";

export type SaveSourceInput = {
  /** Present = update that row rather than creating one. */
  id?: string;
  kind: KnowledgeKind;
  departments: DepartmentSlug[];
  title: string;
  summary?: string | null;
  /** Video/external link. Citations open this, with the chunk's timestamp appended. */
  url?: string | null;
  storagePath?: string | null;
  /** content/training/<dept>/<slug>.mdx, for the repo indexer. Unique when set. */
  sourceRef?: string | null;
  createdBy?: string | null;
  isPublished: boolean;
  body: string;
  format: SourceFormat;
  /** The uploader's three guided answers — see 0011. Fed to summarise.ts and
   *  indexed at weight C, so a document becomes findable by the situation it
   *  answers rather than only by the words it happens to contain. */
  contextCovers?: string | null;
  contextWhen?: string | null;
  contextCalled?: string | null;
};

export type KnowledgeSource = {
  id: string;
  kind: KnowledgeKind;
  departments: DepartmentSlug[];
  title: string;
  summary: string | null;
  url: string | null;
  storage_path: string | null;
  source_ref: string | null;
  is_published: boolean;
  format: SourceFormat;
  indexed_at: string | null;
  index_error: string | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
  context_covers: string | null;
  context_when: string | null;
  context_called: string | null;
  ai_summary: string | null;
  ai_keywords: string | null;
  ai_summary_edited: boolean;
};

const SOURCE_COLUMNS =
  "id, kind, departments, title, summary, url, storage_path, source_ref, is_published, format, indexed_at, index_error, chunk_count, created_at, updated_at, context_covers, context_when, context_called, ai_summary, ai_keywords, ai_summary_edited";

/**
 * Creates or updates a source row and clears its index state.
 *
 * Clearing indexed_at is what makes the UI honest: between a change and its re-index, the
 * chunks on disk are stale, and a row that still says "Indexed · 12 chunks" would be
 * claiming the search reflects an edit it does not yet reflect.
 */
export async function saveSource(input: SaveSourceInput): Promise<string> {
  const db = createAdminClient();

  const row = {
    kind: input.kind,
    departments: input.departments,
    title: input.title.trim(),
    summary: input.summary?.trim() || null,
    url: input.url?.trim() || null,
    storage_path: input.storagePath ?? null,
    source_ref: input.sourceRef ?? null,
    is_published: input.isPublished,
    body: input.body,
    format: input.format,
    context_covers: input.contextCovers?.trim() || null,
    context_when: input.contextWhen?.trim() || null,
    context_called: input.contextCalled?.trim() || null,
    indexed_at: null,
    index_error: null,
  };

  if (input.id) {
    const { error } = await db
      .from("knowledge_sources")
      .update(row)
      .eq("id", input.id);
    if (error) throw new Error(error.message);
    return input.id;
  }

  const { data, error } = await db
    .from("knowledge_sources")
    // onConflict on source_ref so re-running the repo indexer updates in place rather than
    // creating a second copy of every training module.
    .upsert(
      { ...row, created_by: input.createdBy ?? null },
      {
        onConflict: "source_ref",
        ignoreDuplicates: false,
      },
    )
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data.id as string;
}

/**
 * Chunks a source's stored body and replaces its chunks.
 *
 * Never throws. A failure is recorded on the row as index_error and surfaced in the manage
 * table with a Re-index button — an upload that silently indexed nothing is the one
 * failure mode guaranteed to go unnoticed, because the source row still looks fine.
 */
export async function indexSource(
  id: string,
): Promise<{ chunks: number; error?: string }> {
  const db = createAdminClient();

  try {
    const { data: source, error: readErr } = await db
      .from("knowledge_sources")
      .select(
        "title, body, format, storage_path, context_covers, context_when, context_called, ai_summary_edited",
      )
      .eq("id", id)
      .single();
    if (readErr) throw new Error(readErr.message);

    let body = (source?.body as string | null) ?? "";
    let format = (source?.format as SourceFormat) ?? "plain";

    // A PDF's text layer has no pictures in it, and for these documents the pictures
    // are half the instruction. Re-read it properly and let the transcription become
    // the body — it is the document's own words, so it stays citable.
    //
    // Reads the bytes back from Storage rather than taking them as an argument, so a
    // re-index gets the same treatment without anyone re-uploading.
    const storagePath = source?.storage_path as string | null;
    if (storagePath && storagePath.toLowerCase().endsWith(".pdf")) {
      const rendered = await renderPdfFromStorage(storagePath);
      if (rendered) {
        body = rendered;
        format = "markdown";
        await db
          .from("knowledge_sources")
          .update({ body, format })
          .eq("id", id);
      }
    }

    const chunks = chunkFor(format, body);

    if (chunks.length === 0) {
      throw new Error("Nothing to index — the extracted text was empty.");
    }

    // Replace wholesale. Chunks are derived data with a unique (source_id, ordinal), so
    // deleting first is simpler and safer than trying to reconcile a shorter new set
    // against a longer old one — which would silently leave orphans answering questions.
    const { error: delErr } = await db
      .from("knowledge_chunks")
      .delete()
      .eq("source_id", id);
    if (delErr) throw new Error(delErr.message);

    for (let i = 0; i < chunks.length; i += CHUNK_BATCH) {
      const { error } = await db.from("knowledge_chunks").insert(
        chunks.slice(i, i + CHUNK_BATCH).map((c) => ({
          source_id: id,
          ordinal: c.ordinal,
          heading: c.heading,
          content: c.content,
          start_seconds: c.startSeconds,
          anchor: c.anchor,
          // departments deliberately omitted — the 0009 trigger fills it from the source,
          // so it can never drift from what RLS is enforcing.
        })),
      );
      if (error) throw new Error(error.message);
    }

    // Source-level only, never a chunk: this is the model's reading of the material,
    // and a chunk is what gets quoted back to someone as the document's own words.
    // 0011 indexes it at weight B/C so it widens recall without outranking a title.
    if (source?.ai_summary_edited) {
      console.info(
        `[knowledge] ${id} has a hand-edited summary — leaving it alone.`,
      );
    } else {
      const summary = await summariseSource({
        title: (source?.title as string) ?? "",
        body,
        context: {
          covers: source?.context_covers as string | null,
          when: source?.context_when as string | null,
          called: source?.context_called as string | null,
        },
      });
      if (summary.ok) {
        await db
          .from("knowledge_sources")
          .update({
            ai_summary: summary.summary,
            ai_keywords: summary.keywords,
          })
          .eq("id", id);
      } else {
        console.warn(`[knowledge] no AI summary for ${id}: ${summary.reason}`);
      }
    }

    await db
      .from("knowledge_sources")
      .update({
        indexed_at: new Date().toISOString(),
        index_error: null,
        chunk_count: chunks.length,
      })
      .eq("id", id);

    return { chunks: chunks.length };
  } catch (e) {
    const message = (e as Error).message;
    console.error(`[knowledge] index failed for ${id}:`, message);
    await db
      .from("knowledge_sources")
      .update({ index_error: message, chunk_count: 0, indexed_at: null })
      .eq("id", id)
      .then(undefined, () => {});
    return { chunks: 0, error: message };
  }
}

/** Sources a person may see in the manage table. Service-role, so scope explicitly. */
export async function listSources(
  departments: DepartmentSlug[] | "all",
): Promise<KnowledgeSource[]> {
  const db = createAdminClient();
  let q = db
    .from("knowledge_sources")
    .select(SOURCE_COLUMNS)
    .order("updated_at", { ascending: false });

  if (departments !== "all") {
    // Overlaps, plus company-wide (empty array), which everyone can read.
    q = q.or(`departments.ov.{${departments.join(",")}},departments.eq.{}`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as KnowledgeSource[];
}

export async function getSource(id: string): Promise<KnowledgeSource | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("knowledge_sources")
    .select(SOURCE_COLUMNS)
    .eq("id", id)
    .single();
  return (data as unknown as KnowledgeSource) ?? null;
}

/** Chunks cascade; the stored original does not, so remove it explicitly. */
export async function deleteSource(id: string): Promise<void> {
  const db = createAdminClient();
  const source = await getSource(id);
  if (source?.storage_path) {
    await db.storage.from(BUCKET).remove([source.storage_path]);
  }
  const { error } = await db.from("knowledge_sources").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Keeps a readable name in the path while guaranteeing uniqueness. */
function storageKey(filename: string): string {
  const safe = filename
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(-80);
  return `${randomUUID()}/${safe}`;
}

/** Stores the original upload. Private bucket — reads are signed, server-side, per request. */
export async function uploadOriginal(
  filename: string,
  bytes: ArrayBuffer,
  contentType?: string,
) {
  const db = createAdminClient();
  const path = storageKey(filename);
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: contentType || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(`Couldn't store the file: ${error.message}`);
  return path;
}

/**
 * A short-lived link to the original.
 *
 * Minted per request after the caller has checked access — never stored, never handed to
 * the client alongside a list. The bucket is private and has no storage.objects policy, so
 * this is the only way in.
 */
export async function signedUrlFor(
  path: string,
  expiresInSeconds = 300,
): Promise<string | null> {
  const db = createAdminClient();
  const { data } = await db.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  return data?.signedUrl ?? null;
}

/** Downloads a stored PDF and transcribes it. Returns null on any failure — the
 *  caller keeps whatever text extraction already produced. The AI path is an
 *  improvement to indexing, never a precondition for it. */
async function renderPdfFromStorage(path: string): Promise<string | null> {
  try {
    const db = createAdminClient();
    const { data, error } = await db.storage.from(BUCKET).download(path);
    if (error || !data) {
      console.warn(
        `[knowledge] couldn't download ${path} for vision: ${error?.message}`,
      );
      return null;
    }
    const result = await renderPdf(
      new Uint8Array(await data.arrayBuffer()),
      path.split("/").pop() ?? "document.pdf",
    );
    if (!result.ok) {
      console.warn(`[knowledge] vision skipped for ${path}: ${result.reason}`);
      return null;
    }
    return result.markdown;
  } catch (e) {
    console.warn(
      `[knowledge] vision failed for ${path}: ${(e as Error).message}`,
    );
    return null;
  }
}
