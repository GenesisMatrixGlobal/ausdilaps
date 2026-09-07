"use client";

import { useState } from "react";
import { TabBar } from "@/components/ui/tab-bar";
import { EmptyState } from "@/components/staff/empty-state";
import { StatTiles, type Stat } from "@/components/staff/stat-tiles";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TenderSummary } from "@/lib/tenders/summary";

/**
 * The Tender Watch UI.
 *
 * Data arrives already loaded from the server component, so there is no mount effect and
 * no loading flash. `data.now` is the server's clock, captured once — every relative
 * timestamp below is measured from that single instant rather than calling Date.now()
 * during render, which would be impure and produce values that drift on re-render.
 */

type Item = TenderSummary["items"][number];
type Group = TenderSummary["groups"][number];
type Source = TenderSummary["sources"][number];

/**
 * Two panes, not one page.
 *
 * Source health used to sit between the stat tiles and the tenders, which put a diagnostic
 * table in front of the only thing anyone opens this tool to do. It is one click away now.
 */
const PANES = [
  { key: "opportunities", label: "Opportunities" },
  { key: "health", label: "Source health" },
] as const;
type Pane = (typeof PANES)[number]["key"];

/**
 * The queue is the default and everything else is an archive.
 *
 * "Rejected" reads from `items` rather than `groups` — a no_match row is never an
 * opportunity, so grouping it would be work nobody looks at.
 */
const FILTERS = [
  { key: "queue", label: "To review" },
  { key: "sent", label: "Sent" },
  { key: "dismissed", label: "Dismissed" },
  { key: "rejected", label: "Rejected" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

const SERVICE_LABELS: Record<string, string> = {
  dilapidation: "Dilapidation",
  "condition-survey": "Condition survey",
  sia: "SIA",
  doa: "DOA",
  dca: "DCA",
};

function ago(iso: string | null, now: number): string {
  if (!iso) return "never";
  const hours = (now - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)} hr${Math.floor(hours) === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function closesLabel(iso: string | null, now: number): { text: string; urgent: boolean } | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const days = Math.ceil((date.getTime() - now) / 86_400_000);
  const label = date.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Brisbane" });
  if (days < 0) return { text: `Closed ${label}`, urgent: false };
  if (days <= 14) return { text: `Closes ${label} · ${days} day${days === 1 ? "" : "s"}`, urgent: true };
  return { text: `Closes ${label}`, urgent: false };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function Pill({ tone, children }: { tone: "ok" | "warn" | "critical" | "muted"; children: React.ReactNode }) {
  const styles = {
    ok: "bg-ad-steel/10 text-ad-steel",
    warn: "bg-ad-orange/10 text-ad-orange",
    critical: "bg-ad-orange/15 text-ad-orange",
    muted: "bg-ad-surface text-ad-muted",
  } as const;
  return (
    <span className={cn("rounded px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide", styles[tone])}>
      {children}
    </span>
  );
}

export function TenderWatchView({ initial }: { initial: TenderSummary }) {
  const [data, setData] = useState(initial);
  const [pane, setPane] = useState<Pane>("opportunities");
  const [filter, setFilter] = useState<Filter>("queue");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selection is by GROUP KEY, not row id: the unit a person ticks is the opportunity, and
  // one opportunity can be five rows. The ids are expanded only when the request is built,
  // so every duplicate gets marked and none of them come back tomorrow.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Changing list resets the selection — carrying ticks into another tab invites a misfire. */
  function switchFilter(next: Filter) {
    setFilter(next);
    setSelected(new Set());
    setFlash(null);
  }

  async function refresh() {
    const res = await fetch("/api/tenders/summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const json = (await res.json()) as { ok: boolean; error?: string } & Partial<TenderSummary>;
    if (!res.ok || !json.ok) {
      setError(json.error ?? "Couldn't refresh the pipeline.");
      return;
    }
    setData(json as TenderSummary);
  }

  /** Operator toggles on a discovered source. Admin-only server-side. */
  async function updateSource(slug: string, changes: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/tenders/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, ...changes }),
    });
    const json = (await res.json()) as { ok: boolean; error?: string } & Partial<TenderSummary>;
    if (!res.ok || !json.ok) {
      setError(json.error ?? "Couldn't update that source.");
      return;
    }
    setData(json as TenderSummary);
  }

  /**
   * Hand the ticked opportunities to the team, or dismiss them.
   *
   * The selection is cleared only on success. A failed send must leave the ticks exactly as
   * they were so the same button press retries them — re-ticking twelve rows after a
   * transient Resend error is how someone gives up on a tool.
   */
  async function act(action: "send" | "dismiss") {
    const chosen = data.groups.filter((g) => selected.has(g.key));
    const itemIds = chosen.flatMap((g) => g.members.map((m) => m.id));
    if (itemIds.length === 0) return;

    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/tenders/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, itemIds, note: note.trim() || undefined }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        warning?: string;
        sent?: number;
        dismissed?: number;
      } & Partial<TenderSummary>;

      if (!res.ok || !json.ok) {
        setError(json.error ?? "That didn't go through.");
        // The route returns the refreshed summary even on a send failure, so the screen
        // still catches up with anything another person changed meanwhile.
        if (json.groups) setData(json as TenderSummary);
        return;
      }

      setData(json as TenderSummary);
      setSelected(new Set());
      setNote("");
      setFlash(
        json.warning ??
          (action === "send"
            ? `Sent ${json.sent} opportunit${json.sent === 1 ? "y" : "ies"} to the team.`
            : `Dismissed ${chosen.length} opportunit${chosen.length === 1 ? "y" : "ies"}.`)
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runScan() {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/tenders/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "The scan couldn't be started.");
        return;
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  const { now } = data;
  const staleHours = data.stats.lastScanAt ? (now - new Date(data.stats.lastScanAt).getTime()) / 3_600_000 : Infinity;

  // A pipeline that has never run is "not started yet", not "failing" — telling someone
  // their brand-new install has missed 30 nights is noise that trains them to ignore the
  // tile that matters.
  const neverRun = data.stats.lastScanAt === null;

  const tiles: Stat[] = [
    {
      label: `Scans · ${data.windowDays}d`,
      value: data.stats.scans,
      sub: neverRun ? "Not started yet" : data.stats.scans >= 28 ? "Nightly, none missed" : "Some nights missed",
      tone: neverRun ? "default" : data.stats.scans >= 28 ? "ok" : "warn",
    },
    {
      label: "Tenders scanned",
      value: data.stats.scanned.toLocaleString(),
      sub: `across ${data.sources.length} source${data.sources.length === 1 ? "" : "s"}`,
    },
    {
      // Deliberately the number of CARDS below, not a count of rows. The old tile summed a
      // run counter nothing ever wrote, so it read "0 matches" directly above a list of
      // sixteen. Anything on this page that claims a total now comes from the same array
      // the list renders.
      label: "To review",
      value: data.stats.open,
      sub: data.stats.open === 0 ? "Queue is clear" : "Waiting for someone",
      tone: data.stats.open > 0 ? "warn" : "ok",
    },
    {
      label: "Last scan",
      value: data.stats.lastScanAt
        ? new Date(data.stats.lastScanAt).toLocaleTimeString("en-AU", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "Australia/Brisbane",
          })
        : "Never",
      // Red past 30 hours. This one field is the cron-stopped-firing detector, and the
      // most important thing on the page.
      sub: neverRun
        ? "Waiting for the first run"
        : staleHours > 30
          ? `No scan in ${Math.floor(staleHours)} hrs`
          : `${data.stats.lastScanStatus ?? "—"} · ${ago(data.stats.lastScanAt, now)}`,
      tone: neverRun ? "default" : staleHours > 30 ? "critical" : data.stats.lastScanStatus === "succeeded" ? "ok" : "warn",
    },
  ];

  const groupsFor = (key: Filter) =>
    key === "rejected" ? [] : data.groups.filter((g) => g.state === key);
  const rejected = data.items.filter((i) => i.relevance === "no_match");

  const count = (key: Filter) => (key === "rejected" ? rejected.length : groupsFor(key).length);
  const visibleGroups = groupsFor(filter);

  // Nothing to scan and nothing scanned yet — the pipeline is built but not switched on.
  const comingSoon = neverRun && !data.sources.some((s) => s.configured);
  const selectedGroups = data.groups.filter((g) => selected.has(g.key));
  const selectedRows = selectedGroups.reduce((n, g) => n + g.count, 0);

  return (
    <div>
      {comingSoon && (
        <div className="mb-6 rounded-lg border border-ad-steel/30 border-l-[3px] border-l-ad-steel bg-ad-steel/5 p-4">
          <p className="text-sm font-semibold text-ad-ink">Coming soon — not running yet</p>
          <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-ad-muted">
            The pipeline is built and the database is ready, but the nightly scan is switched off and no tender sources
            are connected yet. This screen is here so you can see the shape of it. Nothing below is real data.
          </p>
          <p className="mt-2 text-xs text-ad-muted">
            To switch it on: connect a tender feed, add a scan secret, then re-enable the nightly job. See{" "}
            <code className="rounded bg-white px-1">docs/tender-watch.md</code>.
          </p>
        </div>
      )}

      {data.unavailable && (
        <div className="mb-6 rounded-lg border border-ad-orange/40 bg-ad-orange/5 p-4">
          <p className="text-sm font-semibold text-ad-ink">Tender Watch isn&rsquo;t set up yet</p>
          <p className="mt-1 text-xs text-ad-muted">
            {data.unavailable} Run <code className="rounded bg-white px-1">npm run migrate</code> and set the Tender Watch
            environment variables — see <code className="rounded bg-white px-1">docs/tender-watch.md</code>.
          </p>
        </div>
      )}

      {data.truncated && (
        <p className="mb-4 text-xs text-ad-orange">
          More tenders in the last {data.windowDays} days than this page can list, so the counts below are short. Narrow
          the window with <code className="rounded bg-white px-1">TENDER_WINDOW_DAYS</code>.
        </p>
      )}

      {error && <p className="mb-4 text-sm text-ad-orange">{error}</p>}
      {flash && <p className="mb-4 text-sm font-medium text-ad-steel">{flash}</p>}

      <StatTiles stats={tiles} />

      {(data.queues.pending > 0 || data.queues.stalled > 0) && (
        <p className="mt-3 text-xs text-ad-muted">
          {data.queues.pending > 0 && <span className="mr-3">{data.queues.pending} awaiting classification</span>}
          {data.queues.stalled > 0 && <span className="text-ad-orange">{data.queues.stalled} stalled run(s)</span>}
        </p>
      )}

      <div className="mt-8">
        <TabBar tabs={PANES} active={pane} onChange={setPane} />
      </div>

      {pane === "health" ? (
        <SourceHealth sources={data.sources} now={now} isAdmin={data.isAdmin} onUpdate={updateSource} />
      ) : (
        <section className="mt-5">
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-ad-ink">
                {filter === "queue" ? "Tick what\u2019s worth chasing" : FILTERS.find((f) => f.key === filter)?.label}
              </h3>
              {filter === "queue" && (
                <p className="mt-0.5 text-xs text-ad-muted">
                  Sending emails the details to the team so they can be added to the portal.
                </p>
              )}
            </div>
            <button
              onClick={() => void runScan()}
              // No sources means a scan would do nothing but write an empty run row.
              disabled={scanning || comingSoon}
              title={comingSoon ? "No tender sources are connected yet" : undefined}
              className={cn(
                buttonVariants({ variant: "primary", size: "sm" }),
                (scanning || comingSoon) && "cursor-not-allowed opacity-40"
              )}
            >
              {scanning ? "Scanning\u2026" : "Run scan now"}
            </button>
          </div>

          <TabBar
            tabs={FILTERS.map((f) => ({ key: f.key, label: `${f.label} (${count(f.key)})` }))}
            active={filter}
            onChange={switchFilter}
          />

          {filter === "queue" && visibleGroups.length > 0 && (
            <SelectionBar
              selectedCount={selectedGroups.length}
              selectedRows={selectedRows}
              total={visibleGroups.length}
              note={note}
              busy={busy}
              onNote={setNote}
              onSelectAll={() =>
                setSelected(
                  selected.size === visibleGroups.length ? new Set() : new Set(visibleGroups.map((g) => g.key))
                )
              }
              onSend={() => void act("send")}
              onDismiss={() => void act("dismiss")}
            />
          )}

          {filter === "rejected" ? (
            rejected.length === 0 ? (
              <div className="mt-4">
                <EmptyState title="Nothing rejected yet" body="The prefilter hasn’t turned anything away." />
              </div>
            ) : (
              <div className="overflow-hidden rounded-b-xl border border-t-0 border-ad-border">
                {rejected.map((item) => (
                  <TenderRow key={item.id} item={item} now={now} />
                ))}
              </div>
            )
          ) : visibleGroups.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title={filter === "queue" ? "Nothing waiting" : "Nothing here"}
                body={
                  filter === "queue"
                    ? "Every opportunity has been sent or dismissed."
                    : "Nothing in this list yet."
                }
              />
            </div>
          ) : (
            <div className="overflow-hidden rounded-b-xl border border-t-0 border-ad-border">
              {visibleGroups.map((g) => (
                <GroupCard
                  key={g.key}
                  group={g}
                  now={now}
                  selectable={filter === "queue"}
                  selected={selected.has(g.key)}
                  onToggle={() => toggle(g.key)}
                />
              ))}
            </div>
          )}

          {filter === "rejected" && (
            <p className="mt-2.5 text-xs text-ad-muted">
              Rejected tenders stay visible on purpose. A classifier that quietly starts dropping real work is the
              failure you&rsquo;d never notice — reading a few rejections each week is the only thing that catches it.
            </p>
          )}
        </section>
      )}

      {data.isAdmin && pane === "health" && <AdminPanels data={data} />}
    </div>
  );
}

/**
 * The bar that turns a list into a work queue.
 *
 * Both buttons are disabled with nothing ticked rather than hidden — a control that appears
 * and disappears as you tick things makes the page jump under the cursor.
 */
function SelectionBar({
  selectedCount,
  selectedRows,
  total,
  note,
  busy,
  onNote,
  onSelectAll,
  onSend,
  onDismiss,
}: {
  selectedCount: number;
  selectedRows: number;
  total: number;
  note: string;
  busy: boolean;
  onNote: (v: string) => void;
  onSelectAll: () => void;
  onSend: () => void;
  onDismiss: () => void;
}) {
  const none = selectedCount === 0;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-x border-ad-border bg-ad-surface px-3.5 py-2.5">
      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ad-ink">
        <input
          type="checkbox"
          checked={selectedCount === total && total > 0}
          onChange={onSelectAll}
          className="h-4 w-4 accent-ad-steel"
        />
        {none ? "Select all" : `${selectedCount} selected`}
      </label>

      {/* Only worth saying once something is ticked, and it explains what "5 rows" means. */}
      {!none && selectedRows !== selectedCount && (
        <span className="text-xs text-ad-muted">{selectedRows} alerts</span>
      )}

      <input
        type="text"
        value={note}
        onChange={(e) => onNote(e.target.value)}
        maxLength={600}
        placeholder="Optional note for the team…"
        className="min-w-[12rem] flex-1 rounded border border-ad-border bg-white px-2.5 py-1.5 text-xs text-ad-ink placeholder:text-ad-muted focus:border-ad-steel focus:outline-none"
      />

      <button
        type="button"
        onClick={onDismiss}
        disabled={none || busy}
        title="Archive these without emailing anyone"
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), (none || busy) && "cursor-not-allowed opacity-40")}
      >
        Dismiss
      </button>
      <button
        type="button"
        onClick={onSend}
        disabled={none || busy}
        className={cn(buttonVariants({ variant: "accent", size: "sm" }), (none || busy) && "cursor-not-allowed opacity-40")}
      >
        {busy ? "Sending\u2026" : "Send email"}
      </button>
    </div>
  );
}

/** The panel that catches a portal quietly dropping us off its alert list. */
function SourceHealth({
  sources,
  now,
  isAdmin,
  onUpdate,
}: {
  sources: Source[];
  now: number;
  isAdmin: boolean;
  onUpdate: (slug: string, changes: Record<string, unknown>) => Promise<void>;
}) {
  // Sources are discovered per sender domain, so this list is a handful of real portals
  // followed by a long tail of one-off client invitations. Sort by how much each actually
  // sends, or the portals get buried under people who emailed once.
  const ordered = [...sources].sort(
    (a, b) =>
      Number(b.alertOnQuiet) - Number(a.alertOnQuiet) ||
      b.dailyAverage - a.dailyAverage ||
      b.itemsLastRun - a.itemsLastRun ||
      a.label.localeCompare(b.label)
  );

  return (
    <section className="mt-8">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-ad-ink">Source health</h3>
        <p className="text-xs text-ad-muted">
          {isAdmin
            ? "Sources appear on their own the first time a domain emails. Alerts are opt-in."
            : "A source can go quiet without ever erroring — that\u2019s what this catches."}
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-ad-border">
        {ordered.map((s) => (
          <div
            key={s.slug}
            className={cn(
              "flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-ad-border bg-white p-3.5 last:border-b-0",
              s.configured && s.health !== "healthy" && "bg-ad-orange/5"
            )}
          >
            <div className="flex min-w-[13rem] flex-1 items-center gap-2">
              <span className="text-sm font-semibold text-ad-ink">{s.label}</span>
              <span className="rounded border border-ad-border px-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-ad-muted">
                {s.kind}
              </span>
            </div>
            <span className="text-xs tabular-nums text-ad-muted">
              <b className="text-ad-ink">{s.itemsLastRun}</b> last run
            </span>
            <span className="text-xs tabular-nums text-ad-muted">{s.dailyAverage}/run avg</span>
            <span className="text-xs text-ad-muted">Item {ago(s.lastItemAt, now)}</span>
            {!s.configured ? (
              <Pill tone="muted">Not configured</Pill>
            ) : s.health === "failing" ? (
              <Pill tone="critical">{s.consecutiveFailures} failed</Pill>
            ) : s.health === "healthy" ? (
              <Pill tone="ok">Healthy</Pill>
            ) : (
              <Pill tone="warn">{s.consecutiveEmpty} empty runs</Pill>
            )}
            {isAdmin && s.kind === "email" && (
              <div className="flex shrink-0 gap-1.5">
                <Toggle
                  on={s.alertOnQuiet}
                  onClick={() => void onUpdate(s.slug, { alertOnQuiet: !s.alertOnQuiet })}
                  title={
                    s.alertOnQuiet
                      ? "You'll be told if this source stops sending."
                      : "No alert if this goes quiet — right for one-off senders, turn it on for a real portal."
                  }
                >
                  Alert
                </Toggle>
                <Toggle
                  on={s.isTrusted}
                  onClick={() => void onUpdate(s.slug, { isTrusted: !s.isTrusted })}
                  title={
                    s.isTrusted
                      ? "Mail from this domain is treated as genuine."
                      : "Unverified: items are badged so a reader knows, but nothing is held back \u2014 a person approves every send."
                  }
                >
                  Trusted
                </Toggle>
              </div>
            )}
            {s.lastError && <p className="w-full text-xs text-ad-orange">{s.lastError}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function Toggle({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={cn(
        "rounded border px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide transition-colors",
        on
          ? "border-ad-steel bg-ad-steel/10 text-ad-steel"
          : "border-ad-border text-ad-muted hover:border-ad-steel/50 hover:text-ad-ink"
      )}
    >
      {children}
    </button>
  );
}

/**
 * One opportunity — which may be five emails about the same job.
 *
 * The whole card is a label wrapping the checkbox, so ticking works anywhere on the row
 * rather than only on a 16px square. The tender link is the one exception: it stops
 * propagation, because clicking through to read a notice must not silently tick it.
 */
function GroupCard({
  group,
  now,
  selectable,
  selected,
  onToggle,
}: {
  group: Group;
  now: number;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const lead = group.lead;
  const closes = closesLabel(lead.closesAt, now);
  const primary = group.sources.find((s) => s.url) ?? null;
  const host = primary?.url ? hostOf(primary.url) : null;
  const isMatch = group.members.some((m) => m.relevance === "match");

  return (
    <article
      className={cn(
        "border-b border-ad-border bg-white transition-colors last:border-b-0",
        selected && "bg-ad-steel/5"
      )}
    >
      <div className="flex items-start gap-3 p-4">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${group.title}`}
            className="mt-1 h-4 w-4 shrink-0 accent-ad-steel"
          />
        )}
        <div className={cn("w-[3px] self-stretch rounded-sm", isMatch ? "bg-ad-steel" : "bg-ad-orange")} aria-hidden />

        <div className="min-w-0 flex-1">
          <h4 className="text-[0.925rem] font-semibold text-ad-ink">
            {primary?.url ? (
              <a
                href={primary.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="hover:text-ad-steel hover:underline"
              >
                {group.title}
              </a>
            ) : (
              group.title
            )}
          </h4>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ad-muted">
            {lead.agency && <span>{lead.agency}</span>}
            {closes && (
              <>
                <span className="opacity-40">·</span>
                <span className={cn("tabular-nums", closes.urgent && "font-semibold text-ad-orange")}>
                  {closes.text}
                </span>
              </>
            )}
            {/* Hostname in plain text: escaping an href stops injection, it does not stop
                navigation. A human should see where a link goes before they click it. */}
            {host && (
              <>
                <span className="opacity-40">·</span>
                <span className="font-mono text-[0.7rem]">{host}</span>
              </>
            )}
          </div>

          {(lead.services.length > 0 || !isMatch || group.members.some((m) => m.injectionSuspected)) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {lead.services.map((sv) => (
                <Pill key={sv} tone="ok">
                  {SERVICE_LABELS[sv] ?? sv}
                </Pill>
              ))}
              {!isMatch && <Pill tone="warn">Needs review</Pill>}
              {group.members.some((m) => m.injectionSuspected) && <Pill tone="critical">Flagged content</Pill>}
            </div>
          )}

          {lead.summary && <p className="mt-2 max-w-[78ch] text-[0.85rem] text-ad-ink">{lead.summary}</p>}

          {/* Only when it genuinely arrived more than once — on every card it would be noise. */}
          {group.count > 1 && (
            <p className="mt-2 text-xs text-ad-muted">
              Arrived {group.count} times · {group.sources.map((sv) => sv.label.replace(/^email:/, "")).join(", ")}
            </p>
          )}

          {group.state === "sent" && (
            <p className="mt-2 text-xs text-ad-steel">Sent {ago(lead.forwardedAt, now)}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn("text-lg font-semibold tabular-nums", isMatch ? "text-ad-steel" : "text-ad-orange")}>
            {lead.confidence === null ? "—" : `${Math.round(lead.confidence * 100)}%`}
          </span>
          {group.count > 1 && (
            <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-ad-muted">
              ×{group.count}
            </span>
          )}
        </div>
      </div>

      {lead.reasoning && (
        <details className="border-t border-ad-border">
          <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-ad-steel">Why this verdict</summary>
          <div className="px-4 pb-3.5">
            <p className="max-w-[76ch] text-[0.82rem] text-ad-ink">{lead.reasoning}</p>
            <p className="mt-2 font-mono text-[0.7rem] text-ad-muted">
              {lead.model ?? lead.classifiedBy}
              {lead.classifiedAt ? ` · ${ago(lead.classifiedAt, now)}` : ""}
            </p>
          </div>
        </details>
      )}
    </article>
  );
}

function TenderRow({ item, now }: { item: Item; now: number }) {
  const closes = closesLabel(item.closesAt, now);
  const host = item.url ? hostOf(item.url) : null;
  const rail =
    item.relevance === "match"
      ? "bg-ad-steel"
      : item.relevance === "maybe" || item.relevance === "error"
        ? "bg-ad-orange"
        : "bg-ad-border";

  return (
    <article className="border-b border-ad-border bg-white last:border-b-0">
      <div className="flex items-start gap-3.5 p-4">
        <div className={cn("w-[3px] self-stretch rounded-sm", rail)} aria-hidden />
        <div className="min-w-0 flex-1">
          <h4 className="text-[0.925rem] font-semibold text-ad-ink">
            {item.url ? (
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:text-ad-steel hover:underline">
                {item.title}
              </a>
            ) : (
              item.title
            )}
          </h4>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ad-muted">
            {item.agency && <span>{item.agency}</span>}
            <span className="opacity-40">·</span>
            <span>{item.source}</span>
            {closes && (
              <>
                <span className="opacity-40">·</span>
                <span className={cn("tabular-nums", closes.urgent && "font-semibold text-ad-orange")}>{closes.text}</span>
              </>
            )}
            {/* Hostname in plain text: escaping an href stops injection, it does not stop
                navigation. A human should see where a link goes before they click it. */}
            {host && (
              <>
                <span className="opacity-40">·</span>
                <span className="font-mono text-[0.7rem]">{host}</span>
              </>
            )}
          </div>

          {(item.services.length > 0 || item.injectionSuspected || (!item.senderTrusted && item.classifiedBy !== "prefilter")) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.services.map((s) => (
                <Pill key={s} tone="ok">
                  {SERVICE_LABELS[s] ?? s}
                </Pill>
              ))}
              {!item.senderTrusted && item.classifiedBy !== "prefilter" && <Pill tone="warn">Unverified sender</Pill>}
              {item.injectionSuspected && <Pill tone="critical">Flagged content</Pill>}
            </div>
          )}

          {item.summary && <p className="mt-2 max-w-[78ch] text-[0.85rem] text-ad-ink">{item.summary}</p>}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "text-lg font-semibold tabular-nums",
              item.relevance === "match" ? "text-ad-steel" : item.relevance === "maybe" ? "text-ad-orange" : "text-ad-muted"
            )}
          >
            {item.confidence === null ? "—" : `${Math.round(item.confidence * 100)}%`}
          </span>
          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-ad-muted">
            {item.classifiedBy === "prefilter" ? "Prefiltered" : item.relevance.replace("_", " ")}
          </span>
        </div>
      </div>

      {item.reasoning && (
        <details className="border-t border-ad-border">
          <summary className="cursor-pointer px-4 py-2.5 pl-[2.1rem] text-xs font-medium text-ad-steel">
            Why this verdict
          </summary>
          <div className="px-4 pb-3.5 pl-[2.1rem]">
            <p className="max-w-[76ch] text-[0.82rem] text-ad-ink">{item.reasoning}</p>
            <p className="mt-2 font-mono text-[0.7rem] text-ad-muted">
              {item.model ?? item.classifiedBy}
              {item.classifiedAt ? ` · ${ago(item.classifiedAt, now)}` : ""}
              {item.forwardedAt ? " · sent" : ""}
            </p>
          </div>
        </details>
      )}
    </article>
  );
}

/** Operator detail. The API only populates `runs` when the caller is a company admin. */
function AdminPanels({ data }: { data: TenderSummary }) {
  const f = data.funnel;
  const pct = (n: number, of: number) => (of > 0 ? `${((n / of) * 100).toFixed(1)}%` : "—");

  const steps = [
    { k: "Fetched", v: f.fetched, r: "" },
    { k: "New", v: f.fresh, r: pct(f.fresh, f.fetched) },
    { k: "Duplicate", v: f.duplicate, r: pct(f.duplicate, f.fetched) },
    { k: "Prefiltered", v: f.prefiltered, r: pct(f.prefiltered, f.fresh) },
    { k: "Classified", v: f.classified, r: pct(f.classified, f.fresh) },
    { k: "Matched", v: f.matched, r: pct(f.matched, f.classified) },
    { k: "To review", v: f.review, r: pct(f.review, f.classified) },
    { k: "Sent", v: f.sent, r: pct(f.sent, f.matched + f.review) },
  ];

  return (
    <>
      <section className="mt-10">
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-ad-ink">Pipeline · last {data.windowDays} days</h3>
          <p className="text-xs text-ad-muted">Watch the ratios, not the totals — a stage falling to zero is the tell.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {steps.map((s) => (
            <div key={s.k} className="rounded-lg border border-ad-border bg-white p-3">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-ad-muted">{s.k}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-ad-ink">{s.v}</p>
              <p className="text-[0.7rem] tabular-nums text-ad-muted">{s.r || " "}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h3 className="mb-2.5 text-sm font-semibold text-ad-ink">Recent scans</h3>
        <div className="overflow-x-auto rounded-xl border border-ad-border">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="bg-ad-surface text-left text-ad-muted">
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide">Started</th>
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide">Source</th>
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide">Trigger</th>
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide">Status</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide">Fetched</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide">New</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide">Dupe</th>
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide">Note</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r, i) => (
                <tr key={`${r.source_slug}-${r.started_at}-${i}`} className="border-t border-ad-border">
                  <td className="px-3 py-2 font-mono text-xs text-ad-muted">
                    {new Date(r.started_at).toLocaleString("en-AU", {
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: "Australia/Brisbane",
                    })}
                  </td>
                  <td className="px-3 py-2 text-ad-ink">{r.source_slug}</td>
                  <td className="px-3 py-2 text-ad-muted">{r.triggered_by}</td>
                  <td className="px-3 py-2">
                    <Pill tone={r.status === "succeeded" ? "ok" : r.status === "partial" ? "warn" : "critical"}>{r.status}</Pill>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.items_fetched}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.items_new}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.items_duplicate}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ad-muted">{r.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2.5 text-xs text-ad-muted">
          &ldquo;Partial — digest parsed to zero items&rdquo; is an alarm, not a quiet day. When a portal changes format the
          parser finds nothing and everything else still reports green, so a zero-item digest always creates one fallback
          item and the run is never marked successful.
        </p>
      </section>
    </>
  );
}
