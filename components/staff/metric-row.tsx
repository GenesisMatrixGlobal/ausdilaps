import { cn } from "@/lib/utils";

/**
 * A row of labelled counts, each showing its share of the total.
 *
 * Generalised from the funnel grid in components/tools/tender-watch/view.tsx.
 *
 * NOT CURRENTLY RENDERED. It held the /admin enquiry breakdowns until those were folded
 * into the Enquiries panel as bare figures — with single-digit counts, a card each was far
 * too much furniture. Kept deliberately: the GA4 traffic panel wants exactly this shape
 * (labelled counts with a share of total), and tender-watch still has a private copy that
 * should collapse into this one. Delete it only if both of those stop being true.
 *
 * The share matters more than the count. "12 enquiries" tells you little; "12 enquiries,
 * 60% of them New Quote" tells you what the pipeline is made of, and a shift in that
 * proportion is visible where a shift in raw numbers is not.
 */
export type Metric = {
  label: string;
  value: number;
  /** Overrides the computed share — for funnels where the denominator is the prior stage. */
  hint?: string;
  emphasis?: boolean;
};

export function MetricRow({
  metrics,
  total,
  className,
}: {
  metrics: Metric[];
  /** Denominator for the share line. Defaults to the sum of the values. */
  total?: number;
  className?: string;
}) {
  const sum = total ?? metrics.reduce((n, m) => n + m.value, 0);

  if (metrics.length === 0) {
    return <p className={cn("text-sm text-ad-muted", className)}>Nothing recorded yet.</p>;
  }

  return (
    <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4", className)}>
      {metrics.map((m) => {
        const share = sum > 0 ? `${Math.round((m.value / sum) * 100)}%` : "—";
        return (
          <div
            key={m.label}
            className={cn(
              "rounded-lg border bg-white p-3",
              m.emphasis ? "border-ad-steel" : "border-ad-border"
            )}
          >
            <p className="truncate text-[0.65rem] font-semibold uppercase tracking-wide text-ad-muted" title={m.label}>
              {m.label}
            </p>
            <p
              className={cn(
                "mt-1 text-xl font-semibold tabular-nums",
                m.emphasis ? "text-ad-steel" : "text-ad-ink"
              )}
            >
              {m.value}
            </p>
            <p className="text-[0.7rem] tabular-nums text-ad-muted">{m.hint ?? share}</p>
          </div>
        );
      })}
    </div>
  );
}
