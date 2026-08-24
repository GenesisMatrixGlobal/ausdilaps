/** Shared chrome for every tool page, so the tools themselves render no headings
 *  and stay department-agnostic. */
export function ToolFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-ad-ink">{title}</h2>
      <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ad-muted">{description}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}
