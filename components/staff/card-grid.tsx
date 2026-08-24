import Link from "next/link";

/** The card list used for departments, tools and training modules. */
export function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function LinkCard({
  href,
  title,
  description,
  meta,
}: {
  href: string;
  title: string;
  description: string;
  meta?: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-xl border border-ad-border bg-white p-5 transition-colors hover:border-ad-steel hover:bg-ad-surface/40"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-ad-ink group-hover:text-ad-steel">{title}</h3>
        {meta && (
          <span className="shrink-0 rounded bg-ad-surface px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-ad-muted">
            {meta}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ad-muted">{description}</p>
      <span className="mt-4 text-sm font-medium text-ad-steel">Open →</span>
    </Link>
  );
}
