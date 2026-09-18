import { requireAdmin } from "@/lib/auth/session";
import { StatTiles, type Stat } from "@/components/staff/stat-tiles";
import {
  VISITORS_WINDOW_DAYS,
  loadSamplesVisitors,
  type SampleVisitor,
  type VisitorEvent,
} from "@/lib/admin/samples-visitors";

export const metadata = {
  title: "Samples · AusDilaps Admin",
  robots: { index: false, follow: false },
};

/**
 * Who has been looking at the sample report library, newest first.
 *
 * One expandable row per BROWSER (the visitor cookie), the same shape as /admin/leads. A row
 * has a name only when the person unlocked with their email — the access code is one code
 * on every quote, so a code unlock is anonymous and is shown as one rather than guessed at.
 */

function when(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Brisbane",
  }).format(new Date(iso));
}

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

const UNLOCK_LABEL: Record<SampleVisitor["unlock"], string> = {
  email: "Email unlock",
  code: "Access code",
  earlier: "Unlocked earlier",
  locked: "Locked page only",
};

function describe(e: VisitorEvent): string {
  switch (e.event) {
    case "click_item":
      return `Opened ${e.item ?? "a file"}`;
    case "view_library":
      return "Viewed the library";
    case "view_locked":
      return "Viewed the locked page";
    case "unlock_code":
      return "Unlocked with the access code";
    case "unlock_code_failed":
      return "Tried a wrong access code";
    case "unlock_email":
      return "Unlocked with name and email";
  }
}

const EVENTS_SHOWN = 40;

function VisitorRow({ v }: { v: SampleVisitor }) {
  const title = v.name ?? `Visitor ${v.id.slice(0, 8)}`;
  const opened = v.events.filter((e) => e.event === "click_item");
  return (
    <details className="group border-b border-ad-border last:border-b-0">
      <summary className="flex cursor-pointer list-none items-baseline gap-3 px-4 py-3 hover:bg-ad-surface/60 sm:px-5">
        <span
          aria-hidden
          className="mt-1 shrink-0 text-[0.6rem] text-ad-muted transition-transform group-open:rotate-90"
        >
          ▶
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className={v.name ? "font-heading text-[0.95rem] font-semibold text-ad-ink" : "font-heading text-[0.95rem] font-medium text-ad-muted"}>
              {title}
            </span>
            {v.company && <span className="text-sm text-ad-muted">· {v.company}</span>}
            <span className="rounded-full bg-ad-surface px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-ad-steel">
              {UNLOCK_LABEL[v.unlock]}
            </span>
          </span>
          <span className="mt-0.5 block text-xs text-ad-muted">
            Last seen {ago(v.lastSeen)} · {v.views} {v.views === 1 ? "view" : "views"} ·{" "}
            {v.filesOpened === 0 ? "no files opened" : `${v.filesOpened} ${v.filesOpened === 1 ? "file" : "files"} opened`}
            {" · "}
            {v.device}
            {v.referrer && ` · from ${v.referrer}`}
          </span>
        </span>
        {v.email && (
          <span className="hidden shrink-0 text-right text-xs sm:block">
            <a href={`mailto:${v.email}`} className="block text-ad-steel hover:underline">
              {v.email}
            </a>
          </span>
        )}
      </summary>

      <div className="border-t border-ad-border bg-ad-surface/40 px-4 py-4 sm:px-5">
        <p className="text-xs text-ad-muted">
          First seen {when(v.firstSeen)} · last seen {when(v.lastSeen)}
          {v.email && (
            <>
              {" · "}
              <a href={`mailto:${v.email}`} className="text-ad-steel hover:underline">
                {v.email}
              </a>
            </>
          )}
        </p>

        {opened.length > 0 && (
          <div className="mt-3">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-ad-muted">Files opened</p>
            <ul className="mt-1 space-y-0.5">
              {opened.slice(0, EVENTS_SHOWN).map((e, i) => (
                <li key={i} className="text-sm text-ad-ink">
                  {e.item} <span className="text-xs text-ad-muted">· {when(e.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-ad-muted">History</p>
          <ol className="mt-1 space-y-0.5">
            {v.events.slice(0, EVENTS_SHOWN).map((e, i) => (
              <li key={i} className="text-xs text-ad-muted">
                <span className="tabular-nums">{when(e.at)}</span> · {describe(e)}
              </li>
            ))}
            {v.events.length > EVENTS_SHOWN && (
              <li className="text-xs text-ad-muted">+{v.events.length - EVENTS_SHOWN} earlier</li>
            )}
          </ol>
        </div>
      </div>
    </details>
  );
}

export default async function AdminSamplesPage() {
  await requireAdmin("/admin/samples");
  const { visitors, untrackedViews, unavailable } = await loadSamplesVisitors();

  const named = visitors.filter((v) => v.name).length;
  const opened = visitors.reduce((n, v) => n + v.filesOpened, 0);
  const tiles: Stat[] = [
    { label: `Visitors · ${VISITORS_WINDOW_DAYS}d`, value: visitors.length, sub: "browsers that looked at the samples page" },
    { label: "Identified", value: named, sub: "gave a name and email to get in" },
    { label: "Files opened", value: opened, sub: "distinct files, across all visitors" },
    { label: "Untracked views", value: untrackedViews, sub: "before visitor tracking began", tone: untrackedViews > 0 ? "default" : "ok" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ad-ink">Sample library visitors</h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ad-muted">
        Who has looked at the sample reports in the last {VISITORS_WINDOW_DAYS} days, newest first. A row is
        one browser. It carries a name only when the person unlocked with their email — the access
        code on the quotes is shared, so those visitors stay anonymous. Click a row for the files
        they opened and the full history.
      </p>

      {unavailable ? (
        <div className="mt-6 rounded-xl border border-ad-amber-line bg-ad-amber-tint px-4 py-3">
          <p className="text-sm text-ad-ink">{unavailable}</p>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <StatTiles stats={tiles} columns={4} />
          </div>

          {visitors.length === 0 ? (
            <div className="mt-8 rounded-xl border border-dashed border-ad-border bg-ad-surface/40 px-6 py-10 text-center">
              <p className="font-semibold text-ad-ink">No tracked visitors yet</p>
              <p className="mt-1.5 text-sm text-ad-muted">
                Visitors appear here from their first visit after tracking was switched on.
              </p>
            </div>
          ) : (
            <div className="mt-8 overflow-hidden rounded-xl border border-ad-border bg-white">
              {visitors.map((v) => (
                <VisitorRow key={v.id} v={v} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
