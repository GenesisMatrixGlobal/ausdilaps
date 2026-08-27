import Link from "next/link";

/** The single-column list used for departments, tools and training modules.
 *
 *  Replaced a 2-up card grid: at five departments or six tools the grid was
 *  mostly whitespace, and a scannable column reads faster than a mosaic. One
 *  component for all three lists so the portal keeps one list style.
 *
 *  No max-width here on purpose. Container already centres the page at 1240px, and
 *  a second cap inside it doesn't narrow the content symmetrically — it pins it to
 *  the container's LEFT edge. At 1920px that put the rows at 40% of the screen with
 *  their centre ~200px left of the screen's, which reads as a misalignment rather
 *  than as a narrower column. Cap prose, never cap the layout block. */
export function RowList({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-ad-border overflow-hidden rounded-xl border border-ad-border bg-white">
      {children}
    </div>
  );
}

export function LinkRow({
  href,
  code,
  title,
  description,
  meta,
}: {
  href: string;
  /** Short reference code (tools only) — see ToolDefinition.code. */
  code?: string;
  title: string;
  description: string;
  meta?: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-ad-surface/60"
    >
      {code && (
        <span className="shrink-0 rounded border border-ad-border bg-ad-surface px-2 py-1 font-mono text-[0.7rem] font-semibold tracking-wide text-ad-muted transition-colors group-hover:border-ad-steel group-hover:text-ad-steel">
          {code}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {/* Wraps rather than truncates: min-w-0 on the parent is what stops flex
              overflowing, so clipping the title bought nothing and hid it on mobile. */}
          <h3 className="font-semibold text-ad-ink group-hover:text-ad-steel">{title}</h3>
          {meta && (
            <span className="shrink-0 text-[0.7rem] font-semibold uppercase tracking-wide text-ad-muted">
              {meta}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm leading-relaxed text-ad-muted">{description}</p>
      </div>

      <span
        aria-hidden
        className="shrink-0 text-ad-muted transition-colors group-hover:text-ad-steel"
      >
        →
      </span>
    </Link>
  );
}
