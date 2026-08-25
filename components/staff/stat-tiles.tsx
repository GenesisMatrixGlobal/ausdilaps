/** The 4-up figure row on /admin, extracted so Tender Watch (and the /admin/leads table
 *  when it lands) render an identical one instead of a third hand-rolled copy. */
export type Stat = {
  label: string;
  value: string | number;
  /** Optional second line — "1 per night, none missed", "Succeeded · 6 hrs ago". */
  sub?: string;
  /** Colours the sub line when it carries state rather than context. */
  tone?: "default" | "ok" | "warn" | "critical";
};

const TONE = {
  default: "text-ad-muted",
  ok: "text-ad-steel",
  warn: "text-ad-orange",
  critical: "text-ad-orange font-semibold",
} as const;

export function StatTiles({ stats }: { stats: Stat[] }) {
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-xl border border-ad-border bg-white p-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-ad-muted">{s.label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-ad-ink">{s.value}</dd>
          {s.sub && <p className={`mt-1 text-xs ${TONE[s.tone ?? "default"]}`}>{s.sub}</p>}
        </div>
      ))}
    </dl>
  );
}
