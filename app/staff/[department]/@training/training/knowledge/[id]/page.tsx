import Link from "next/link";
import { notFound } from "next/navigation";
import { isDepartmentSlug } from "@/lib/departments";
import { requireDepartment } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Markdown } from "@/components/marketing/markdown";
import { ScrollToHash } from "@/components/staff/scroll-to-hash";
import { DownloadOriginal } from "./download-original";

/** The reading page for uploaded material — a PDF, a pasted note, a video transcript.
 *
 *  Training modules have a page because they're MDX in the repo. An upload had
 *  nothing: it was listed nowhere, linked from nowhere, and a search result could
 *  only show a snippet. This is the page that makes an upload a real thing you can
 *  open, and it gives citations somewhere to land.
 *
 *  Lives under /training/ so DepartmentTabs and DepartmentPanes keep the Training tab
 *  active — both test pathname.startsWith(`${base}/training`). */
export async function generateMetadata() {
  return { robots: { index: false, follow: false } };
}

export default async function KnowledgeSourcePage({
  params,
}: {
  params: Promise<{ department: string; id: string }>;
}) {
  const { department, id } = await params;
  if (!isDepartmentSlug(department)) notFound();
  await requireDepartment(department, `/staff/${department}/training`);

  // User-scoped client: RLS decides whether this person may see this source, and
  // whether it's published. Never the admin client — that would hand every
  // department's material to anyone who could guess an id.
  const supabase = await createClient();
  const { data: source, error } = await supabase
    .from("knowledge_sources")
    .select(
      "id, kind, title, summary, body, url, storage_path, updated_at, is_published, departments"
    )
    .eq("id", id)
    .maybeSingle();

  // Invisible and non-existent are the same answer on purpose.
  if (error || !source || !source.is_published) notFound();

  // The URL says which department this is being read as, so hold it to that:
  // tagged for this department, or company-wide. RLS alone won't do it — an admin
  // passes has_department() everywhere, so without this an Estimators document
  // would open happily under a /staff/reports/ URL.
  const tags = (source.departments ?? []) as string[];
  if (tags.length > 0 && !tags.includes(department)) notFound();

  const updated = source.updated_at
    ? new Date(source.updated_at).toISOString().slice(0, 10)
    : null;

  return (
    <article className="max-w-3xl">
      <ScrollToHash />

      <Link
        href={`/staff/${department}/training`}
        className="text-sm font-medium text-ad-steel hover:underline"
      >
        ← All training
      </Link>

      <h2 className="mt-4 font-heading text-2xl font-semibold text-ad-ink sm:text-3xl">
        {source.title}
      </h2>
      {source.summary && (
        <p className="mt-2 leading-relaxed text-ad-muted">{source.summary}</p>
      )}

      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ad-muted">
        {source.kind === "video" ? "Video" : source.storage_path ? "Document" : "Note"}
        {updated && ` · Updated ${updated}`}
      </p>

      <div className="mt-5 flex flex-wrap gap-4">
        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-ad-steel hover:underline"
          >
            Open the video →
          </a>
        )}
        {source.storage_path && <DownloadOriginal department={department} sourceId={source.id} />}
      </div>

      {source.body ? (
        <div className="mt-8">
          <Markdown source={source.body} />
        </div>
      ) : (
        <p className="mt-8 text-sm text-ad-muted">
          Nothing readable was extracted from this one — use the download above.
        </p>
      )}
    </article>
  );
}
