import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { DEPARTMENTS } from "@/lib/departments";
import { TOOLS, departmentsFor, isArchived, isGame, type ToolDefinition } from "@/lib/tools/registry";
import { loadToolUsage, type ToolUsageStat } from "@/lib/tools/usage";
import { createAdminClient } from "@/lib/supabase/admin";
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

type UsageStat = Pick<ToolUsageStat, "last30Days" | "lastUsedAt" | "byUser" | "unattributed">;

/** "Rhys Morgan 9 · Kylie Crosson 3 · 4 unattributed" — who is behind the count. Names come
 *  from profiles; a user whose profile is gone shows by id prefix rather than vanishing, so
 *  the parts still add up to the total. */
function usedBy(stat: UsageStat | undefined, names: Map<string, string>): string | null {
  // Nobody named yet (every row pre-dates 0020) → no line. "Used by 73 unattributed" tells
  // the reader nothing the count above didn't; the footnote covers what unattributed means.
  if (!stat || stat.byUser.length === 0) return null;
  const parts = stat.byUser.map(
    (u) => `${names.get(u.userId) ?? u.userId.slice(0, 8)} ${u.count}`
  );
  if (stat.unattributed > 0) parts.push(`${stat.unattributed} unattributed`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** One row. Identical for a live tool and an archived one — a retired tool that rendered
 *  differently would be harder to compare against the ones that replaced it. */
function ToolRow({
  tool,
  stat,
  names,
}: {
  tool: ToolDefinition;
  stat: UsageStat | undefined;
  names: Map<string, string>;
}) {
  // Any of a tool's departments resolves for an admin — canAccess() grants admins
  // every department — so the first one is as good a route as any. This is why
  // there are no per-tool /admin routes: they'd be a second path to one component.
  // departmentsFor() rather than tool.departments: a game has no departments field,
  // and reading index [0] off one would build "/staff/undefined/tools/<slug>".
  const href = `/staff/${departmentsFor(tool)[0]}/tools/${tool.slug}`;
  const count = stat?.last30Days ?? 0;
  const by = usedBy(stat, names);

  return (
    <Link href={href} className="group block p-4 transition-colors hover:bg-ad-surface/50 sm:p-5">
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
      {by && <p className="mt-1.5 text-xs text-ad-muted">Used by {by}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {/* A game is in every department, so listing all five labels is noise. */}
        {isGame(tool) ? (
          <>
            <Pill tone="ok">Game</Pill>
            <Pill tone="ok">All departments</Pill>
          </>
        ) : isArchived(tool) ? (
          // The departments an archived tool WAS under are history, not an assignment — it
          // appears under none of them now, so showing them as live pills would be a lie.
          <Pill tone="warn">Archived</Pill>
        ) : (
          tool.departments.map((slug) => (
            <Pill key={slug} tone="ok">
              {DEPARTMENTS.find((d) => d.slug === slug)?.label ?? slug}
            </Pill>
          ))
        )}
        <span className="ml-auto text-sm font-medium text-ad-steel opacity-0 transition-opacity group-hover:opacity-100">
          Open →
        </span>
      </div>
    </Link>
  );
}

/** user id → display name, for the "Used by" line. Best-effort: without it the counts still
 *  render, just by id prefix. */
async function loadStaffNames(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { data, error } = await createAdminClient().from("profiles").select("id, full_name, email");
    if (error) throw error;
    for (const r of data ?? []) {
      out.set(r.id as string, (r.full_name as string | null) || (r.email as string) || (r.id as string));
    }
  } catch (e) {
    console.error("[admin] couldn't load staff names:", (e as Error).message);
  }
  return out;
}

export default async function AdminToolsPage() {
  await requireAdmin("/admin/tools");
  const [usage, names] = await Promise.all([loadToolUsage(), loadStaffNames()]);
  const live = TOOLS.filter((t) => !isArchived(t));
  const archived = TOOLS.filter(isArchived);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ad-ink">Tools</h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ad-muted">
        Click any tool to open it. Tool-to-department assignment lives in code (
        <code className="rounded bg-ad-surface px-1 py-0.5 text-[0.8em]">lib/tools/registry.ts</code>) so it ships and
        reviews with the tool itself.
      </p>

      <div className="mt-8 divide-y divide-ad-border overflow-hidden rounded-xl border border-ad-border bg-white">
        {live.map((tool) => (
          <ToolRow key={tool.slug} tool={tool} stat={usage.get(tool.slug)} names={names} />
        ))}
      </div>

      {archived.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold text-ad-ink">Archived</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ad-muted">
            Retired from the staff tool lists and out of the department counts. Still here, still opens — so a past
            job can be reviewed, and the history under it still points at something.
          </p>
          <div className="mt-3 divide-y divide-ad-border overflow-hidden rounded-xl border border-ad-border bg-white opacity-75">
            {archived.map((tool) => (
              <ToolRow key={tool.slug} tool={tool} stat={usage.get(tool.slug)} names={names} />
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ad-muted">
        Counts one request to each tool&rsquo;s main endpoint — generating a markup, sizing a property, exporting a plan.
        Supporting calls like address autocomplete aren&rsquo;t counted, or a single search would register dozens of
        uses. A request that failed still counts as an attempt, since the count is taken before the work runs. &ldquo;Unattributed&rdquo; uses were recorded before
        per-person tracking was switched on.
      </p>
    </div>
  );
}
