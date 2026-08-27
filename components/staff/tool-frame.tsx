/** Shared chrome for every tool page, so the tools themselves render no headings
 *  and stay department-agnostic. */
export function ToolFrame({
  title,
  code,
  description,
  children,
}: {
  title: string;
  /** Short reference code (SMK, PSZ, ...) — shown so someone looking at a tool
   *  can quote it in a message without leaving the page. */
  code?: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-semibold text-ad-ink">{title}</h2>
        {code && (
          <span className="rounded border border-ad-border bg-ad-surface px-2 py-0.5 font-mono text-[0.7rem] font-semibold tracking-wide text-ad-muted">
            {code}
          </span>
        )}
      </div>
      <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ad-muted">{description}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}
