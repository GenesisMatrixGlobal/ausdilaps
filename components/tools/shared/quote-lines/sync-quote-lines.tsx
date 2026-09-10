"use client";

// The sheet's footer: paste a Salesforce Quote, confirm it, create one line item per ticked row.
//
// Two steps on purpose — Find, then Create — so the Quote number, its Opportunity and how many
// line items it ALREADY has are on screen before anything is written. Creating a second set of
// lines on a Quote that already has them is the mistake this is shaped to prevent; there is no
// server-side dedupe, so the warning and the post-success lock are what stand in the way.
//
// Lives inside the shared table rather than beside it, so every tool that hosts the sheet gets
// the same control without wiring it up.

import { useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { LineItemRow } from "@/lib/markup-layers/line-items";
import { rowReason, type Refusal } from "@/lib/quote-lines/payload";

export interface ResolvedQuote {
  id: string;
  name: string | null;
  number: string | null;
  opportunityName: string | null;
  existingLines: number;
  url: string | null;
}

interface CreateResult {
  created: { key: string; id: string }[];
  quoteUrl: string | null;
}

export interface SyncQuoteLinesProps {
  /** Prefill for the paste box — Building Markup hands over whatever its PNG sync resolved. */
  initialQuoteInput?: string;
}

/** What is about to be sent, so a change to any ticked row unlocks Create again. */
function signatureOf(rows: LineItemRow[]): string {
  return JSON.stringify(rows.filter((r) => r.selected).map((r) => [r.key, r.values]));
}

export function SyncQuoteLines({ rows, initialQuoteInput }: SyncQuoteLinesProps & { rows: LineItemRow[] }) {
  const [quoteInput, setQuoteInput] = useState(initialQuoteInput ?? "");
  const [quote, setQuote] = useState<ResolvedQuote | null>(null);
  const [busy, setBusy] = useState<"find" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState<Refusal[]>([]);
  const [result, setResult] = useState<{ signature: string; outcome: CreateResult } | null>(null);

  const ticked = rows.filter((r) => r.selected);
  const blocked = ticked
    .map((r) => ({ row: r, reason: rowReason(r.values) }))
    .filter((x): x is { row: LineItemRow; reason: string } => x.reason !== null);
  const ready = ticked.length - blocked.length;
  const signature = signatureOf(rows);
  const alreadyCreated = result?.signature === signature;

  function reset() {
    setQuote(null);
    setError(null);
    setRefused([]);
  }

  async function find() {
    setError(null);
    setBusy("find");
    try {
      const res = await fetch("/api/salesforce/quote-lines/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteInput }),
      });
      const json = (await res.json().catch(() => null)) as { ok: boolean; quote?: ResolvedQuote; error?: string } | null;
      if (!res.ok || !json?.quote) {
        setError(json?.error ?? "Couldn't look that Quote up.");
        setQuote(null);
        return;
      }
      setQuote(json.quote);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!quote) return;
    setError(null);
    setRefused([]);
    setBusy("create");
    try {
      const res = await fetch("/api/salesforce/quote-lines/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quoteId: quote.id,
          rows: ticked.map((r) => ({ key: r.key, values: r.values })),
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; result?: CreateResult; refused?: Refusal[]; error?: string }
        | null;
      if (!res.ok || !json?.result) {
        setError(json?.error ?? "Creating the line items failed.");
        setRefused(json?.refused ?? []);
        return;
      }
      setResult({ signature, outcome: json.result });
      setQuote({ ...quote, existingLines: quote.existingLines + json.result.created.length });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-t border-ad-border px-4 py-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[20rem] flex-1 text-sm font-medium text-ad-ink">
          Sync to Salesforce
          <input
            value={quoteInput}
            onChange={(e) => {
              setQuoteInput(e.target.value);
              reset();
            }}
            placeholder="Paste the Salesforce Quote URL"
            className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm font-normal text-ad-ink outline-none focus:border-ad-steel"
          />
        </label>
        {!quote && (
          <button
            className={cn(buttonVariants({ variant: "primary", size: "md" }))}
            onClick={find}
            disabled={busy !== null || !quoteInput.trim()}
          >
            {busy === "find" ? "Looking up…" : "Find"}
          </button>
        )}
      </div>

      {/* Readiness is shown BEFORE Find: which rows would go and which would be refused is
          knowable from the sheet alone, and finding that out after pasting a Quote is late. */}
      <p className="mt-2 text-sm text-ad-muted">
        <span className="font-medium text-ad-ink">{ready}</span> ticked row{ready === 1 ? "" : "s"} ready
        {blocked.length > 0 && (
          <>
            {" · "}
            <span className="font-medium text-ad-orange">{blocked.length}</span> can&apos;t sync
          </>
        )}
      </p>
      {blocked.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-sm text-ad-muted">
          {blocked.map(({ row, reason }) => (
            <li key={row.key}>
              {row.number !== null ? `${row.number} · ` : ""}
              {row.values.street || row.source.label}: {reason}
            </li>
          ))}
        </ul>
      )}

      {quote && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-ad-muted">
            Quote <span className="font-medium text-ad-ink">{quote.number ?? quote.id}</span>
            {quote.name && <span className="text-ad-muted"> · {quote.name}</span>}
            {" — "}Opportunity <span className="font-medium text-ad-ink">{quote.opportunityName ?? "—"}</span>
          </p>
          {quote.existingLines > 0 && (
            <p className="text-ad-orange">
              This Quote already has {quote.existingLines} line item{quote.existingLines === 1 ? "" : "s"}. Creating
              adds to them — it does not replace anything.
            </p>
          )}
          <button
            className={cn(buttonVariants({ variant: "accent", size: "md" }))}
            onClick={create}
            disabled={busy !== null || ready === 0 || blocked.length > 0 || alreadyCreated}
            title={
              blocked.length > 0
                ? "Untick or fix the rows that can't sync first"
                : alreadyCreated
                  ? "These rows are already on the Quote — change a row to create again"
                  : undefined
            }
          >
            {busy === "create"
              ? "Creating…"
              : alreadyCreated
                ? "Created"
                : `Create ${ready} line item${ready === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-lg border border-ad-border bg-ad-surface p-3 text-sm">
          <p className="font-medium text-ad-ink">
            Created {result.outcome.created.length} line item{result.outcome.created.length === 1 ? "" : "s"}
            {quote?.number ? ` on Quote ${quote.number}` : ""}.
          </p>
          <p className="mt-1 text-ad-muted">
            Unit price is a $1 placeholder — finalise pricing in Salesforce off the m² and rate fields.
          </p>
          {result.outcome.quoteUrl && (
            <a
              href={result.outcome.quoteUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-ad-steel underline"
            >
              Open the Quote
            </a>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-ad-orange">{error}</p>}
      {refused.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-sm text-ad-orange">
          {refused.map((r) => (
            <li key={r.key}>
              {r.street || r.key}: {r.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
