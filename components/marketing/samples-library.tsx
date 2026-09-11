"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { SampleCategory, SampleItem, SampleKind } from "@/lib/samples";

/**
 * The sample-report library: category chips + a title search over a card grid. A client
 * island in the same shape as PortfolioGrid — the data is resolved on the server (Box,
 * ISR) and handed over as plain items, so filtering is instant and costs no request.
 *
 * Every card opens Box's own viewer in a new tab. Deliberately not an in-page embed: some
 * of these files are 30–120 MB and Box's viewer streams them better than an iframe in a
 * modal would, and the size on the card tells people what they're about to open.
 */
export function SamplesLibrary({ categories }: { categories: SampleCategory[] }) {
  const [active, setActive] = useState<string>("All");
  const [query, setQuery] = useState("");

  const all = useMemo(() => categories.flatMap((c) => c.items), [categories]);
  const q = query.trim().toLowerCase();

  const matches = (item: SampleItem) =>
    (active === "All" || item.category === active) &&
    (q === "" || `${item.title} ${item.category} ${item.year ?? ""}`.toLowerCase().includes(q));

  const visible = categories
    .map((c) => ({ ...c, items: c.items.filter(matches) }))
    .filter((c) => c.items.length > 0);
  const shown = visible.reduce((n, c) => n + c.items.length, 0);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0">
          {["All", ...categories.map((c) => c.name)].map((name) => {
            const count =
              name === "All" ? all.length : categories.find((c) => c.name === name)?.items.length ?? 0;
            const on = active === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => setActive(name)}
                aria-pressed={on}
                className={cn(
                  "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                  on
                    ? "border-ad-accent bg-ad-accent text-white"
                    : "border-ad-border bg-white text-ad-ink hover:border-ad-accent/40"
                )}
              >
                {name}
                <span className={cn("ml-1.5", on ? "text-white/70" : "text-ad-muted")}>{count}</span>
              </button>
            );
          })}
        </div>

        <label className="relative block sm:w-72">
          <span className="sr-only">Search samples</span>
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ad-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="9" cy="9" r="5.5" />
            <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search — hospital, tunnel, drone…"
            className="h-11 w-full rounded-full border border-ad-border bg-white pl-10 pr-4 text-sm text-ad-ink placeholder:text-ad-muted/70 focus:border-ad-accent focus:outline-none"
          />
        </label>
      </div>

      {shown === 0 ? (
        <p className="mt-12 text-ad-muted">
          Nothing matches &ldquo;{query}&rdquo;. Try a shorter word, or clear the search and pick a
          category.
        </p>
      ) : (
        <div className="mt-10 space-y-14">
          {visible.map((c) => (
            <section key={c.name} aria-labelledby={`cat-${slug(c.name)}`}>
              <div className="flex items-baseline justify-between gap-4">
                <h2
                  id={`cat-${slug(c.name)}`}
                  className="font-heading text-xl font-semibold tracking-tight text-ad-ink"
                >
                  {c.name}
                </h2>
                <span className="text-sm text-ad-muted">
                  {c.items.length} {c.items.length === 1 ? "file" : "files"}
                </span>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {c.items.map((item) => (
                  <SampleCard key={item.url} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function SampleCard({ item }: { item: SampleItem }) {
  const meta = [KIND_LABEL[item.kind], item.size, item.year].filter(Boolean).join(" · ");
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-4 rounded-xl border border-ad-border bg-white p-5 transition-colors hover:border-ad-accent/40 hover:bg-ad-surface/60"
    >
      <KindIcon kind={item.kind} />
      <div className="min-w-0 flex-1">
        <h3 className="font-heading text-[0.95rem] font-semibold leading-snug text-ad-ink group-hover:text-ad-accent">
          {item.title}
        </h3>
        <p className="mt-1.5 text-xs font-medium uppercase tracking-wide text-ad-muted">{meta}</p>
      </div>
      <span
        aria-hidden
        className="mt-0.5 shrink-0 text-ad-muted transition-colors group-hover:text-ad-accent"
      >
        ↗
      </span>
    </a>
  );
}

const KIND_LABEL: Record<SampleKind, string> = { pdf: "PDF", video: "Video", image: "Image" };

function KindIcon({ kind }: { kind: SampleKind }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ad-surface text-ad-accent">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7">
        {kind === "pdf" && (
          <>
            <path d="M7 3h7l5 5v13H7z" strokeLinejoin="round" />
            <path d="M14 3v5h5" strokeLinejoin="round" />
            <path d="M9.5 16.5v-4h1.6a1.4 1.4 0 0 1 0 2.8H9.5" strokeLinecap="round" />
          </>
        )}
        {kind === "video" && (
          <>
            <rect x="3" y="6" width="13" height="12" rx="1.5" />
            <path d="m16 10 5-2.5v9L16 14" strokeLinejoin="round" />
          </>
        )}
        {kind === "image" && (
          <>
            <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="m4 18 5-5 3.5 3.5 3-3L20 18" strokeLinejoin="round" />
          </>
        )}
      </svg>
    </span>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
