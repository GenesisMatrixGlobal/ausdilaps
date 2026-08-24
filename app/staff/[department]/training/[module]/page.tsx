import Link from "next/link";
import { notFound } from "next/navigation";
import { isDepartmentSlug } from "@/lib/departments";
import { getTrainingModule } from "@/lib/training";
import { Markdown } from "@/components/marketing/markdown";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ department: string; module: string }>;
}) {
  const { department, module } = await params;
  const mod = isDepartmentSlug(department) ? getTrainingModule(department, module) : null;
  return {
    title: mod ? `${mod.title} · AusDilaps Staff` : "Staff portal · AusDilaps",
    robots: { index: false, follow: false },
  };
}

export default async function TrainingModulePage({
  params,
}: {
  params: Promise<{ department: string; module: string }>;
}) {
  const { department, module } = await params;
  if (!isDepartmentSlug(department)) notFound();

  const mod = getTrainingModule(department, module);
  if (!mod) notFound();

  return (
    <article className="max-w-3xl">
      <Link
        href={`/staff/${department}/training`}
        className="text-sm font-medium text-ad-steel hover:underline"
      >
        ← All training
      </Link>

      <h2 className="mt-4 text-2xl font-semibold text-ad-ink">{mod.title}</h2>
      <p className="mt-2 leading-relaxed text-ad-muted">{mod.summary}</p>

      {(mod.duration || mod.updated) && (
        <p className="mt-3 text-xs uppercase tracking-wide text-ad-muted">
          {[mod.duration, mod.updated && `Updated ${mod.updated}`].filter(Boolean).join(" · ")}
        </p>
      )}

      {mod.video && (
        <div className="mt-6 aspect-video overflow-hidden rounded-xl border border-ad-border bg-ad-surface">
          <iframe
            src={mod.video}
            title={`${mod.title} walkthrough`}
            allowFullScreen
            className="size-full"
          />
        </div>
      )}

      <div className="mt-8 space-y-4 leading-relaxed text-ad-muted">
        <Markdown source={mod.content} />
      </div>

      {mod.attachments && mod.attachments.length > 0 && (
        <div className="mt-10 rounded-xl border border-ad-border bg-ad-surface/50 p-5">
          <h3 className="text-sm font-semibold text-ad-ink">Related documents</h3>
          <ul className="mt-3 space-y-2">
            {mod.attachments.map((a) => (
              <li key={a.href}>
                <a
                  href={a.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-ad-steel hover:underline"
                >
                  {a.label} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
