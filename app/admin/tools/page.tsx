import { requireAdmin } from "@/lib/auth/session";
import { DEPARTMENTS } from "@/lib/departments";
import { TOOLS } from "@/lib/tools/registry";

export default async function AdminToolsPage() {
  await requireAdmin("/admin/tools");

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ad-ink">Tools</h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ad-muted">
        Read-only. Tool-to-department assignment lives in code (
        <code className="rounded bg-ad-surface px-1 py-0.5 text-[0.8em]">lib/tools/registry.ts</code>
        ) so it ships and reviews with the tool itself. Adding a department to a tool&rsquo;s
        <code className="mx-1 rounded bg-ad-surface px-1 py-0.5 text-[0.8em]">departments</code>
        array is the whole change.
      </p>

      <div className="mt-8 divide-y divide-ad-border overflow-hidden rounded-xl border border-ad-border bg-white">
        {TOOLS.map((tool) => (
          <div key={tool.slug} className="p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="font-semibold text-ad-ink">{tool.title}</h2>
              <code className="text-xs text-ad-muted">{tool.slug}</code>
            </div>
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ad-muted">
              {tool.description}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tool.departments.map((slug) => (
                <span
                  key={slug}
                  className="rounded bg-ad-steel/10 px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-ad-steel"
                >
                  {DEPARTMENTS.find((d) => d.slug === slug)?.label ?? slug}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
