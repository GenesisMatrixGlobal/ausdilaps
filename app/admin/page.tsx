const TOOLS = [
  {
    title: "Property Sizing Tool",
    description:
      "Paste addresses or upload a screenshot to get sizing estimates from QLD cadastre data.",
    href: "/admin/property-sizing",
    team: "Estimating Team",
  },
  {
    title: "Road Analysis",
    description: "Build survey path .kml files, or trace real roads for a footpath/road register.",
    href: "/admin/kml-builder",
    team: "Inspectors Team",
  },
  {
    title: "Site Markup",
    description:
      "Snapshot a road from above with the inspection area highlighted, for estimating and project scoping.",
    href: "/admin/site-markup",
    team: "Estimating / Projects",
  },
];

export default function AdminHomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-xs uppercase tracking-[0.15em] text-ad-steel">AusDilaps · Field Tools</p>
      <h1 className="mt-1 text-3xl font-semibold text-ad-ink">Staff Tools</h1>
      <p className="mt-2 max-w-2xl text-ad-muted">
        Internal tools for the AusDilaps team. Pick a tool below to get started.
      </p>

      <div className="mt-8 divide-y divide-ad-border rounded-xl border border-ad-border bg-white">
        {TOOLS.map((tool) => (
          <a
            key={tool.href}
            href={tool.href}
            className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-ad-surface sm:px-6"
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[0.95rem] font-semibold text-ad-ink group-hover:text-ad-steel">
                  {tool.title}
                </h2>
                <span className="rounded bg-ad-surface px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-ad-muted">
                  {tool.team}
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-ad-muted">{tool.description}</p>
            </div>
            <span className="shrink-0 text-sm font-medium text-ad-steel">Open →</span>
          </a>
        ))}
      </div>
    </main>
  );
}
