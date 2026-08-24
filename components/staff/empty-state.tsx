export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-ad-border bg-ad-surface/40 px-6 py-10 text-center">
      <p className="font-semibold text-ad-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-ad-muted">{body}</p>
    </div>
  );
}
