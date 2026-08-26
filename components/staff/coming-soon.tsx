/**
 * A reserved slot on the dashboard — something worth having that isn't connected yet.
 *
 * Two rules this exists to enforce:
 *
 *   1. It must look DELIBERATELY empty, not broken. Dashed border, muted, no numbers. The
 *      attention strip only works if an alarming-looking panel means something is actually
 *      wrong — so a panel that is merely waiting has to read as calm. Compare the Site
 *      Health tile next to it, which is showing a real failure and should look like one.
 *
 *   2. It says what unblocks it. "Coming soon" is decoration; a list of the two things
 *      standing in the way makes the dashboard a to-do list in the one place someone
 *      actually looks.
 */
export function ComingSoon({
  title,
  what,
  needs,
  docs,
}: {
  title: string;
  /** One line: what this will show once it works. */
  what: string;
  /** The specific things standing in the way. Keep them concrete and checkable. */
  needs: string[];
  /** Optional pointer to where the setup is written down. */
  docs?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-ad-border bg-ad-surface/40 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ad-muted">{title}</h3>
        <span className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-wide text-ad-muted">
          Not connected
        </span>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-ad-muted">{what}</p>

      <ul className="mt-3 space-y-1">
        {needs.map((n) => (
          <li key={n} className="flex gap-2 text-xs text-ad-muted">
            <span aria-hidden className="select-none text-ad-border">
              □
            </span>
            <span>{n}</span>
          </li>
        ))}
      </ul>

      {docs && (
        <p className="mt-3 text-[0.7rem] text-ad-muted">
          Setup: <code className="rounded bg-white px-1 py-0.5">{docs}</code>
        </p>
      )}
    </div>
  );
}
