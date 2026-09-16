"use client";

// File the drawing: the PNG into the opportunity's Box folder, its link onto
// Opportunity.Closeout_Markup__c.
//
// One field, one record — the operator already resolved and saw that record in the card above,
// so unlike the quote sync there is no second find step and no folder to choose. The Box folder
// comes off the opportunity; a job without one can still paste a folder link.

import { useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { CloseoutOpportunity } from "@/lib/closeout-markup/types";

interface UploadResult {
  fileName: string;
  sharedLink: string;
  linkedToOpportunity: boolean;
  linkError?: string;
  replacedExistingLink: boolean;
  sidecarFileName?: string;
  sidecarError?: string;
}

export function FileToSalesforce({
  opportunity,
  getImageBase64,
  getSidecar,
  fallbackName,
  disabled,
}: {
  opportunity: CloseoutOpportunity;
  /** Lazy: nothing is rendered or billed while the operator is still deciding. */
  getImageBase64: () => Promise<string>;
  getSidecar: (imageFilename: string) => { filename: string; contentBase64: string; contentType?: string };
  fallbackName: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filename, setFilename] = useState(fallbackName);
  const [folderUrl, setFolderUrl] = useState("");
  const [linkToOpportunity, setLinkToOpportunity] = useState(true);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  const folder = opportunity.boxFolderUrl ?? folderUrl.trim();

  async function upload() {
    setError(null);
    setBusy(true);
    try {
      const image = await getImageBase64();
      const res = await fetch("/api/salesforce/closeout-markup/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          opportunityId: opportunity.id,
          boxFolderUrl: folder,
          filename,
          image,
          linkToOpportunity,
          replaceExistingLink: replaceExisting,
          existingMarkupUrl: opportunity.existingMarkupUrl,
          sidecar: getSidecar(filename),
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok: boolean; result?: UploadResult; error?: string } | null;
      if (!res.ok || !json?.result) throw new Error(json?.error ?? "Couldn't file the markup.");
      setResult(json.result);
      // Overwriting is never something to do twice by momentum — same rule as "Clear the Quote
      // first" on the markup sync.
      setReplaceExisting(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Same label and same accent variant as the markup tabs' control (components/tools/shared/
  // sync-to-salesforce.tsx). The action is the same one — file the PNG to Box, write its link
  // onto a Salesforce record — so an operator moving between the tools should not have to
  // work out that a differently-worded button does the thing they already know.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={cn(buttonVariants({ variant: "accent", size: "md" }))}
      >
        Sync To Salesforce
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-ad-border bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ad-ink">Sync To Salesforce</p>
          <p className="mt-0.5 text-xs text-ad-muted">
            Into {opportunity.name}&apos;s Box folder, then onto its Closeout Markup field.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="-mr-1 -mt-1 rounded p-1 leading-none text-ad-muted hover:bg-ad-surface hover:text-ad-ink"
        >
          ×
        </button>
      </div>

      <label className="mt-3 block text-xs text-ad-muted">
        File name
        <input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          className="mt-1 w-full rounded-lg border border-ad-border px-3 py-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
        />
      </label>

      {!opportunity.boxFolderUrl && (
        // The escape hatch the quote sync has too: an opportunity whose Box folder field is
        // empty is a data gap, not a reason to stop.
        <label className="mt-3 block text-xs text-ad-orange">
          This opportunity has no Box folder — paste one
          <input
            value={folderUrl}
            onChange={(e) => setFolderUrl(e.target.value)}
            placeholder="https://ausdilaps.app.box.com/folder/123456789"
            className="mt-1 w-full rounded-lg border border-ad-border px-3 py-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
          />
        </label>
      )}

      <label className="mt-3 flex items-center gap-2 text-sm text-ad-ink">
        <input type="checkbox" checked={linkToOpportunity} onChange={(e) => setLinkToOpportunity(e.target.checked)} />
        Write the link to the Closeout Markup field
      </label>

      {opportunity.existingMarkupUrl && linkToOpportunity && (
        <label className="mt-2 flex items-center gap-2 text-sm text-ad-orange">
          <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
          Replace the closeout markup already on this opportunity
        </label>
      )}

      <button
        type="button"
        onClick={() => void upload()}
        disabled={busy || !folder || !filename.trim()}
        className={cn(buttonVariants({ variant: "accent", size: "md" }), "mt-3")}
      >
        {busy ? "Filing…" : "Upload"}
      </button>

      {error && <p className="mt-2 text-sm text-ad-orange">{error}</p>}

      {result && (
        <div className="mt-3 rounded-lg bg-ad-surface p-3 text-sm text-ad-ink">
          <p>
            Filed <span className="font-medium">{result.fileName}</span>
            {result.sidecarFileName && ` and ${result.sidecarFileName}`}.
          </p>
          {result.linkedToOpportunity && (
            <p className="mt-1 text-ad-muted">
              {result.replacedExistingLink ? "Replaced the link on" : "Linked to"} the opportunity&apos;s Closeout
              Markup field.
            </p>
          )}
          {/* Reported, never thrown: the file is in Box either way, and re-uploading would only
              make a second copy. */}
          {result.linkError && <p className="mt-1 text-ad-orange">Link not written — {result.linkError}</p>}
          {result.sidecarError && <p className="mt-1 text-ad-orange">Save file not filed — {result.sidecarError}</p>}
        </div>
      )}
    </div>
  );
}
