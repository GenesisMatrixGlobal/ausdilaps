"use client";

// Paste the opportunity, press Find. One Salesforce round trip, no cadastre and no Google, so
// this is fast and free at any job size — a 700-property opportunity comes back as quickly as a
// 4-property one, and the operator sees what they are dealing with before anything is drawn.

import { useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type {
  CloseoutOpportunity,
  CloseoutProperty,
  CouncilAsset,
  SkippedWorkOrder,
  UnmappedWorkOrder,
} from "@/lib/closeout-markup/types";

interface ResolveResponse {
  ok: boolean;
  opportunity?: CloseoutOpportunity;
  properties?: CloseoutProperty[];
  unmapped?: UnmappedWorkOrder[];
  skipped?: SkippedWorkOrder[];
  councilAssets?: CouncilAsset[];
  workOrderCount?: number;
  error?: string;
}

export function OpportunityCard({
  opportunity,
  workOrderCount,
  onResolved,
  onReset,
}: {
  opportunity: CloseoutOpportunity | null;
  workOrderCount: number;
  onResolved: (data: {
    opportunity: CloseoutOpportunity;
    properties: CloseoutProperty[];
    unmapped: UnmappedWorkOrder[];
    skipped: SkippedWorkOrder[];
    councilAssets: CouncilAsset[];
    workOrderCount: number;
  }) => void;
  onReset: () => void;
}) {
  const [input, setInput] = useState("");
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function find() {
    const value = input.trim();
    if (!value) return;
    setError(null);
    setFinding(true);
    try {
      const res = await fetch("/api/salesforce/closeout-markup/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ opportunityInput: value }),
      });
      const json = (await res.json().catch(() => null)) as ResolveResponse | null;
      if (!res.ok || !json?.opportunity || !json.properties) {
        throw new Error(json?.error ?? "Couldn't read that opportunity.");
      }
      onResolved({
        opportunity: json.opportunity,
        properties: json.properties,
        unmapped: json.unmapped ?? [],
        skipped: json.skipped ?? [],
        councilAssets: json.councilAssets ?? [],
        workOrderCount: json.workOrderCount ?? 0,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFinding(false);
    }
  }

  return (
    <div className="rounded-xl border border-ad-border bg-white p-4">
      <p className="text-sm font-medium text-ad-ink">Opportunity</p>
      <p className="mt-1 text-xs text-ad-muted">
        Paste the Salesforce Opportunity link. Its work orders become the properties on the drawing.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            // Changing the text invalidates whatever is on screen — the same rule the quote
            // sync uses, so a drawing can never belong to a different job from the box above it.
            setError(null);
            onReset();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void find();
          }}
          placeholder="https://ausdilaps.lightning.force.com/lightning/r/Opportunity/006.../view"
          className="min-w-0 flex-1 rounded-lg border border-ad-border px-3 py-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
        />
        <button
          type="button"
          onClick={() => void find()}
          disabled={finding || !input.trim()}
          className={cn(buttonVariants({ variant: "primary", size: "md" }))}
        >
          {finding ? "Reading…" : "Find"}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-ad-orange">{error}</p>}

      {opportunity && (
        <div className="mt-3 rounded-lg bg-ad-surface p-3 text-sm">
          <p className="font-medium text-ad-ink">{opportunity.name}</p>
          <p className="mt-0.5 text-xs text-ad-muted">
            {[opportunity.accountName, opportunity.stageName].filter(Boolean).join(" · ")}
            {workOrderCount > 0 && ` · ${workOrderCount} work order${workOrderCount === 1 ? "" : "s"}`}
          </p>
          {opportunity.existingMarkupUrl && (
            <p className="mt-1 text-xs text-ad-orange">
              This opportunity already has a closeout markup filed.
            </p>
          )}
          {!opportunity.boxFolderUrl && (
            <p className="mt-1 text-xs text-ad-orange">
              No Box folder on this opportunity — the drawing can still be downloaded, but not filed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
