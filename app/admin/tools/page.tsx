import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { DEPARTMENTS } from "@/lib/departments";
import { TOOLS } from "@/lib/tools/registry";
import { loadToolUsage } from "@/lib/tools/usage";
import { Pill } from "@/components/staff/pill";

export const metadata = {
  title: "Tools · AusDilaps Admin",
  robots: { index: false, follow: false },
};

function relative(iso: string | null): string {
  if (!iso) return "never used";
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 24) return "used today";
  const days = Math.floor(hours / 24);
  return `last used ${days} day${days === 1 ? "" : "s"} ago`;
}

export default async function AdminToolsPage() {
  await requireAdmin("/admin/tools");
  const usage = await loadToolUsage();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ad-ink">Tools</h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ad-muted">
        Click any tool to open it. Tool-to-department assignment lives in code (
        <code className="rounded bg-ad-surface px-1 py-0.5 text-[0.8em]">lib/tools/registry.ts</code>) so it ships and
        reviews with the tool itself.
      </p>

      <div className="mt-8 divide-y divide-ad-border overflow-hidden rounded-xl border border-ad-border bg-white">
        {TOOLS.map((tool) => {
          // Any of a tool's departments resolves for an admin — canAccess() grants admins
          // every department — so the first one is as good a route as any. This is why
          // there are no per-tool /admin routes: they'd be a second path to one component.
          const href = `/staff/${tool.departments[0]}/tools/${tool.slug}`;
          const stat = usage.get(tool.slug);
          const count = stat?.last30Days ?? 0;

          return (
            <Link
              key={tool.slug}
              href={href}
              className="group block p-4 transition-colors hover:bg-ad-surface/50 sm:p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h2 className="font-semibold text-ad-ink group-hover:text-ad-steel">{tool.title}</h2>
                  <code className="text-xs text-ad-muted">{tool.slug}</code>
                </div>
                <div className="flex items-center gap-2">
                  {/* Zero is the interesting number: either nobody needs it, or nobody
                      knows it exists. Worth showing rather than hiding. */}
                  <span className="text-sm font-semibold tabular-nums text-ad-ink">{count}</span>
                  <span className="text-xs text-ad-muted">
                    {count === 1 ? "use" : "uses"} · 30d · {relative(stat?.lastUsedAt ?? null)}
                  </span>
                </div>
              </div>

              <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ad-muted">{tool.description}</p>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {tool.departments.map((slug) => (
                  <Pill key={slug} tone="ok">
                    {DEPARTMENTS.find((d) => d.slug === slug)?.label ?? slug}
                  </Pill>
                ))}
                <span className="ml-auto text-sm font-medium text-ad-steel opacity-0 transition-opacity group-hover:opacity-100">
                  Open →
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ad-muted">
        Counts one request to each tool&rsquo;s main endpoint — generating a markup, sizing a property, exporting a plan.
        Supporting calls like address autocomplete aren&rsquo;t counted, or a single search would register dozens of
        uses. A request that failed still counts as an attempt, since the count is taken before the work runs.
      </p>
    </div>
  );
}
