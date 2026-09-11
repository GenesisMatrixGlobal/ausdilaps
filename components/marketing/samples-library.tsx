"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { SampleCategory, SampleItem, SampleKind } from "@/lib/samples";

/**
 * The sample-report library: category chips over a compact list. A client island in the
 * same shape as PortfolioGrid — the data is resolved on the server (Box, ISR) and handed
 * over as plain items, so filtering is instant and costs no request.
 *
 * Deliberately a LIST, not a card grid, and with NO search box (Rhys, 2026-09-11): 45 files
 * in three-column cards ran to several screens, and the chips already narrow the list to
 * a handful of rows. Keep each row short so a category fits on one screen.
 *
 * Every row opens Box's own viewer in a new tab. Deliberately not an in-page embed: some
 * of these files are 30–120 MB and Box's viewer streams them better than an iframe in a
 * modal would, and the size on the row tells people what they're about to open.
 */
export function SamplesLibrary({ categories }: { categories: SampleCategory[] }) {
  const [active, setActive] = useState<string>("All");
  const total = categories.reduce((n, c) => n + c.items.length, 0);
  const visible = active === "All" ? categories : categories.filter((c) => c.name === active);

  return (
    <div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0">
        {["All", ...categories.map((c) => c.name)].map((name) => {
          const count =
            name === "All" ? total : categories.find((c) => c.name === name)?.items.length ?? 0;
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

      <div className="mt-8 space-y-10">
        {visible.map((c) => (
          <section key={c.name} aria-labelledby={`cat-${slug(c.name)}`}>
            <div className="flex items-baseline justify-between gap-4">
              <h2
                id={`cat-${slug(c.name)}`}
                className="font-heading text-lg font-semibold tracking-tight text-ad-ink"
              >
                {c.name}
              </h2>
              <span className="text-sm text-ad-muted">
                {c.items.length} {c.items.length === 1 ? "file" : "files"}
              </span>
            </div>
            <ul className="mt-3 divide-y divide-ad-border rounded-xl border border-ad-border bg-white">
              {c.items.map((item) => (
                <li key={item.url}>
                  <SampleRow item={item} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function SampleRow({ item }: { item: SampleItem }) {
  const meta = [KIND_LABEL[item.kind], item.size, item.year].filter(Boolean).join(" · ");
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-ad-surface/70 sm:gap-4 sm:px-5"
    >
      <KindIcon kind={item.kind} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-heading text-[0.95rem] font-medium text-ad-ink group-hover:text-ad-accent">
          {item.title}
        </span>
        {/* Size matters most on a phone — a 150 MB PDF on 4G is a bad surprise — so the
            meta drops under the title there rather than disappearing. */}
        <span className="block text-[0.7rem] font-medium uppercase tracking-wide text-ad-muted sm:hidden">
          {meta}
        </span>
      </span>
      <span className="hidden shrink-0 text-xs font-medium uppercase tracking-wide text-ad-muted sm:block">
        {meta}
      </span>
      <span
        aria-hidden
        className="shrink-0 text-ad-muted transition-colors group-hover:text-ad-accent"
      >
        ↗
      </span>
    </a>
  );
}

const KIND_LABEL: Record<SampleKind, string> = { pdf: "PDF", video: "Video", image: "Image" };

function KindIcon({ kind }: { kind: SampleKind }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ad-surface text-ad-accent">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
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
