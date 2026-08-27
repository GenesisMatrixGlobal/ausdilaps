"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import type { KnowledgeHit } from "@/lib/knowledge/retrieve";
import type { SearchResult } from "@/app/staff/[department]/@training/training/search-action";

/** The department knowledge search — keyword only, no model in the loop.
 *
 *  The unit of a result is a CHUNK, not a file: a 90-minute video is a useless
 *  answer, "14:22 — ring the subject lot first" is the product. Every hit carries
 *  a deep link back to the exact heading or timestamp it came from. */

const KIND_LABEL: Record<KnowledgeHit["kind"], string> = {
  training: "Training",
  document: "Document",
  video: "Video",
  note: "Note",
};

/** 0010 wraps matched terms in « » rather than <mark> — ts_headline does not escape
 *  the source text, so HTML from an uploaded document would render as markup. Split
 *  and build the elements here instead of trusting a string. */
function Highlighted({ text }: { text: string }) {
  return (
    <>
      {text.split(/«([^»]*)»/g).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-ad-orange/15 px-0.5 text-ad-ink">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export function KnowledgeSearch({
  department,
  search,
  getFile,
}: {
  department: string;
  search: (department: string, query: string) => Promise<SearchResult>;
  getFile: (
    department: string,
    sourceId: string
  ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
}) {
  // Controlled, because React resets an uncontrolled input once a form action
  // resolves — which emptied the box every time, exactly when someone wants to
  // adjust a word and search again.
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    const q = query;
    setFileError(null);
    start(async () => setResult(await search(department, q)));
  }

  function openFile(sourceId: string) {
    setFileError(null);
    start(async () => {
      const res = await getFile(department, sourceId);
      // Opened rather than <a download>: the URL is a short-lived signed link
      // minted per click, so there's nothing to put in the markup ahead of time.
      if (res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
      else setFileError(res.error);
    });
  }

  function clear() {
    setQuery("");
    setResult(null);
    setFileError(null);
  }

  return (
    <div>
      <form action={submit} className="flex gap-2">
        <input
          name="q"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          placeholder="What can I help you with?"
          aria-label="Search training and knowledge"
          className="min-w-0 flex-1 rounded-lg border border-ad-border bg-white px-4 py-2.5 text-sm text-ad-ink outline-none transition-colors placeholder:text-ad-muted focus:border-ad-steel"
        />
        <button
          type="submit"
          disabled={pending}
          className={cn(
            "shrink-0 rounded-lg bg-ad-ink px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90",
            pending && "opacity-60"
          )}
        >
          {pending ? "Searching…" : "Search"}
        </button>
      </form>

      {result && (
        <div className="mt-4 rounded-xl border border-ad-border bg-ad-surface/40 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium text-ad-ink">
              {!result.ok
                ? "Search problem"
                : result.hits.length === 0
                  ? `Nothing on “${result.query}” yet`
                  : `${result.hits.length} ${result.hits.length === 1 ? "result" : "results"} for “${result.query}”`}
            </p>
            <button
              type="button"
              onClick={clear}
              className="shrink-0 text-sm font-medium text-ad-steel hover:underline"
            >
              Clear
            </button>
          </div>

          {!result.ok ? (
            <p className="mt-1.5 text-sm text-ad-orange">{result.error}</p>
          ) : result.hits.length === 0 ? (
            <p className="mt-1.5 text-sm text-ad-muted">
              This searches the modules below plus anything uploaded under Manage knowledge.
              Try fewer or different words — or ask whoever owns this area to add it.
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {result.hits.map((hit) => (
                <li
                  key={hit.chunkId}
                  className="rounded-lg border border-ad-border bg-white p-3.5"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-ad-muted">
                      {KIND_LABEL[hit.kind]}
                    </span>
                    <span className="text-sm font-semibold text-ad-ink">{hit.sourceTitle}</span>
                    {hit.heading && (
                      <span className="text-sm text-ad-muted">› {hit.heading}</span>
                    )}
                  </div>

                  <p className="mt-1.5 text-sm leading-relaxed text-ad-muted">
                    <Highlighted text={hit.snippet} />
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                    {hit.href && (
                      <Link
                        href={hit.href}
                        className="text-sm font-medium text-ad-steel hover:underline"
                      >
                        {hit.timestamp ?? "Open"} →
                      </Link>
                    )}
                    {hit.hasOriginal && (
                      <button
                        type="button"
                        onClick={() => openFile(hit.sourceId)}
                        className="text-sm font-medium text-ad-steel hover:underline"
                      >
                        Download original
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {fileError && <p className="mt-3 text-sm text-ad-orange">{fileError}</p>}
        </div>
      )}
    </div>
  );
}
