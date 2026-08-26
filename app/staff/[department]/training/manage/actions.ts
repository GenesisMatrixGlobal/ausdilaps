"use server";

// Knowledge-base management.
//
// Server actions are publicly reachable endpoints — the layout guard does NOT protect
// them — so every one re-checks for itself, exactly as app/admin/staff/actions.ts does.
//
// Two separate checks, and conflating them is the bug to avoid:
//
//   1. May this person manage knowledge for the department whose page they are on?
//   2. May they act on THIS PARTICULAR source, given the departments it is tagged with?
//
// Only checking (1) would let an estimator delete a company-wide policy by posting its id
// to the estimators route. assertCanEditSource() is check (2).

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  requireKnowledgeEditor,
  canEditKnowledge,
  isAdmin,
  type StaffUser,
} from "@/lib/auth/session";
import { isDepartmentSlug, normaliseDepartments, type DepartmentSlug } from "@/lib/departments";
import {
  extractUpload,
  detectFormat,
  UnreadableUpload,
  type SourceFormat,
} from "@/lib/knowledge/extract";
import {
  saveSource,
  indexSource,
  deleteSource,
  uploadOriginal,
  getSource,
  signedUrlFor,
  type KnowledgeKind,
  type KnowledgeSource,
} from "@/lib/knowledge/ingest";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * The form asks one question — is this a video? — not three.
 *
 * "Paste a note" used to be its own mode, but it was only ever "upload a file" with the
 * file input taken away: that form already had a paste box. document vs note is a real
 * distinction in the DATA (is there an original to download?) and no distinction at all in
 * the ASKING, so it is derived here rather than put to the user.
 */
type Mode = "content" | "video";

function kindFor(mode: Mode, hasFile: boolean): KnowledgeKind {
  if (mode === "video") return "video";
  return hasFile ? "document" : "note";
}

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** The department page this action was submitted from. */
async function gate(fd: FormData): Promise<
  { user: StaffUser; department: DepartmentSlug } | { error: string }
> {
  const department = str(fd, "department");
  if (!isDepartmentSlug(department)) return { error: "Unknown department." };
  const user = await requireKnowledgeEditor(department);
  return { user, department };
}

/**
 * Check (2): may this person act on this specific row?
 *
 * Re-read from the database rather than trusting anything posted — the departments in the
 * form are what the client claims, not what the row actually carries.
 */
async function assertCanEditSource(
  user: StaffUser,
  id: string
): Promise<{ source: KnowledgeSource } | { error: string }> {
  const source = await getSource(id);
  if (!source) return { error: "That item no longer exists." };
  if (!canEditKnowledge(user, source.departments)) {
    return { error: "That item belongs to a department you don't manage." };
  }
  return { source };
}

/** Departments the form asked for, filtered to what this person may actually publish to. */
function resolveDepartments(
  fd: FormData,
  user: StaffUser,
  fallback: DepartmentSlug
): { departments: DepartmentSlug[] } | { error: string } {
  const companyWide = str(fd, "company_wide") === "on";

  if (companyWide) {
    // Empty array = company-wide. Admins only: a single estimator should not be able to
    // publish something that answers on behalf of the whole company.
    if (!isAdmin(user)) return { error: "Only company admins can publish company-wide content." };
    return { departments: [] };
  }

  const requested = normaliseDepartments(fd.getAll("departments").map(String));
  const departments = requested.length > 0 ? requested : [fallback];

  if (!canEditKnowledge(user, departments)) {
    return { error: "You can only publish to departments you belong to." };
  }
  return { departments };
}

/**
 * Pulls the content out of the form: an uploaded file, or pasted text.
 *
 * Returns the storage path too, so the original stays downloadable. Pasted text has no
 * original, which is exactly why knowledge_sources.body exists.
 */
async function readContent(
  fd: FormData,
  fileField: string,
  textField: string
): Promise<{ text: string; format: SourceFormat; storagePath: string | null } | { error: string }> {
  const file = fd.get(fileField);
  const pasted = str(fd, textField);

  if (file instanceof File && file.size > 0) {
    try {
      const bytes = await file.arrayBuffer();
      const extracted = await extractUpload(file.name, bytes);
      const storagePath = await uploadOriginal(file.name, bytes, file.type);
      return { text: extracted.text, format: extracted.format, storagePath };
    } catch (e) {
      if (e instanceof UnreadableUpload) return { error: e.message };
      return { error: `Couldn't read that file: ${(e as Error).message}` };
    }
  }

  if (pasted) return { text: pasted, format: detectFormat(pasted), storagePath: null };
  return { error: "Add a file or paste the text — there's nothing to index yet." };
}

/**
 * Index after responding.
 *
 * Chunking a long PDF is not something to make someone watch. The row shows "Indexing…"
 * until indexed_at lands, and an error is recorded on the row rather than thrown away —
 * see indexSource(), which never throws.
 */
function indexInBackground(id: string, department: DepartmentSlug): void {
  after(async () => {
    await indexSource(id);
    revalidatePath(`/staff/${department}/training/manage`);
  });
}

export async function addKnowledge(fd: FormData): Promise<ActionResult> {
  const g = await gate(fd);
  if ("error" in g) return { ok: false, error: g.error };
  const { user, department } = g;

  const title = str(fd, "title");
  if (!title) return { ok: false, error: "Give it a title — that's what people see in the answer." };

  const mode: Mode = str(fd, "mode") === "video" ? "video" : "content";

  const dept = resolveDepartments(fd, user, department);
  if ("error" in dept) return { ok: false, error: dept.error };

  const url = str(fd, "url");
  if (mode === "video") {
    if (!url) return { ok: false, error: "A video needs its link — that's what a citation opens." };
    if (!/^https:\/\//i.test(url)) return { ok: false, error: "The video link must start with https://" };
  }

  const content = await readContent(fd, "file", "text");
  if ("error" in content) {
    return {
      ok: false,
      error:
        mode === "video"
          ? `${content.error} A video with no transcript can't be searched — add the .vtt/.srt, or paste it in.`
          : content.error,
    };
  }

  try {
    const id = await saveSource({
      kind: kindFor(mode, content.storagePath !== null),
      departments: dept.departments,
      title,
      summary: str(fd, "summary") || null,
      url: url || null,
      storagePath: content.storagePath,
      createdBy: user.id,
      isPublished: str(fd, "publish") === "on",
      body: content.text,
      format: content.format,
    });

    indexInBackground(id, department);
    revalidatePath(`/staff/${department}/training/manage`);
    return { ok: true, message: `"${title}" saved. Indexing now — refresh in a moment.` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function reindexKnowledge(fd: FormData): Promise<ActionResult> {
  const g = await gate(fd);
  if ("error" in g) return { ok: false, error: g.error };

  const id = str(fd, "id");
  const check = await assertCanEditSource(g.user, id);
  if ("error" in check) return { ok: false, error: check.error };

  // Synchronous here, unlike an upload: re-index is a deliberate "did that work?" action,
  // and the answer is the point.
  const result = await indexSource(id);
  revalidatePath(`/staff/${g.department}/training/manage`);
  return result.error
    ? { ok: false, error: result.error }
    : { ok: true, message: `Re-indexed — ${result.chunks} chunk${result.chunks === 1 ? "" : "s"}.` };
}

export async function setKnowledgePublished(fd: FormData): Promise<ActionResult> {
  const g = await gate(fd);
  if ("error" in g) return { ok: false, error: g.error };

  const id = str(fd, "id");
  const check = await assertCanEditSource(g.user, id);
  if ("error" in check) return { ok: false, error: check.error };

  const publish = str(fd, "publish") === "true";
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { error } = await createAdminClient()
      .from("knowledge_sources")
      .update({ is_published: publish })
      .eq("id", id);
    if (error) throw new Error(error.message);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  revalidatePath(`/staff/${g.department}/training/manage`);
  return {
    ok: true,
    message: publish ? "Published — it can answer questions now." : "Unpublished — it won't be used in answers.",
  };
}

export async function removeKnowledge(fd: FormData): Promise<ActionResult> {
  const g = await gate(fd);
  if ("error" in g) return { ok: false, error: g.error };

  const id = str(fd, "id");
  const check = await assertCanEditSource(g.user, id);
  if ("error" in check) return { ok: false, error: check.error };

  try {
    await deleteSource(id);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  revalidatePath(`/staff/${g.department}/training/manage`);
  return { ok: true, message: `"${check.source.title}" deleted.` };
}

/**
 * A short-lived link to the stored original.
 *
 * Minted per click after the access check, never included in the page. The bucket is
 * private and carries no storage.objects policy, so a signed URL is the only way in.
 */
export async function knowledgeDownloadUrl(
  fd: FormData
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const g = await gate(fd);
  if ("error" in g) return { ok: false, error: g.error };

  const check = await assertCanEditSource(g.user, str(fd, "id"));
  if ("error" in check) return { ok: false, error: check.error };
  if (!check.source.storage_path) {
    return { ok: false, error: "This one was pasted in — there's no original file." };
  }

  const url = await signedUrlFor(check.source.storage_path);
  return url ? { ok: true, url } : { ok: false, error: "Couldn't create a download link." };
}
