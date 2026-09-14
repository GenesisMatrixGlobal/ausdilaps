import Link from "next/link";

/** The 4-up figure row on /admin, extracted so Tender Watch (and the /admin/leads table
 *  when it lands) render an identical one instead of a third hand-rolled copy. */
export type Stat = {
  label: string;
  value: string | number;
  /** Optional second line — "1 per night, none missed", "Succeeded · 6 hrs ago". */
  sub?: string;
  /** Colours the sub line when it carries state rather than context. */
  tone?: "default" | "ok" | "warn" | "critical";
  /** Makes the whole tile a link. A figure you can click through to is worth more than one
   *  you have to go and find the page for. */
  href?: string;
};

// Amber, not ad-orange: orange is reserved for CTAs, and at #e8642a it reads as an error.
// "critical" is kept in the type for the day something genuinely is one — today nothing
// this dashboard measures qualifies, so it renders the same as warn.
const TONE = {
  default: "text-ad-muted",
  ok: "text-ad-steel",
  warn: "text-ad-amber",
  critical: "text-ad-amber font-medium",
} as const;

export function StatTiles({ stats, columns = 4 }: { stats: Stat[]; columns?: 3 | 4 | 5 | 6 }) {
  // Explicit strings, not a template — Tailwind only ships classes it can see in source.
  const cols = { 3: "sm:grid-cols-3", 4: "sm:grid-cols-4", 5: "sm:grid-cols-5", 6: "sm:grid-cols-6" }[columns];
  // An odd count leaves a hole beside the last tile on the 2-up phone grid. Widening that
  // tile reads as deliberate; a gap reads as something failed to render.
  const orphan = stats.length % 2 === 1 ? "max-sm:last:col-span-2" : "";
  return (
    <dl className={`grid grid-cols-2 gap-4 ${cols}`}>
      {stats.map((s) => {
        const body = (
          <>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ad-muted">
              {s.label}
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-ad-ink">{s.value}</dd>
            {s.sub && <p className={`mt-1 text-xs ${TONE[s.tone ?? "default"]}`}>{s.sub}</p>}
          </>
        );
        const box = `rounded-xl border border-ad-border bg-white p-4 ${orphan}`;
        return s.href ? (
          <Link
            key={s.label}
            href={s.href}
            className={`${box} block transition-colors hover:border-ad-accent/40 hover:bg-ad-surface/40`}
          >
            {body}
          </Link>
        ) : (
          <div key={s.label} className={box}>
            {body}
          </div>
        );
      })}
    </dl>
  );
}
