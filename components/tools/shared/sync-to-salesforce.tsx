"use client";

// Shared "Sync To Salesforce" control for both markup tools.
//
// Takes a callback rather than image bytes: the two tools hold their image differently
// (Residential re-renders a clean, pin-free copy; Road Markup already has a blob), and each
// knows which version should be filed.
//
// Two steps on purpose — find, then confirm — so the Opportunity name and destination folder
// are on screen before anything is written to Box or Salesforce.

import { useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

interface ResolvedTarget {
  quoteId: string;
  quoteNumber: string | null;
  quoteName: string | null;
  opportunityName: string | null;
  boxFolderLink: string | null;
  folder: { id: string; path: string } | null;
  needsManualFolder: boolean;
  missingStep?: string;
  suggestedFilename: string;
  nextMarkupSlot: number | null;
  markupSlotsUsed: number;
  markupSlotsTotal: number;
}

interface UploadResult {
  fileId: string;
  fileName: string;
  sharedLink: string | null;
  previewLink?: string | null;
  linkedToQuote: boolean;
  linkError?: string;
  markupSlot?: number;
}

export interface SyncToSalesforceProps {
  /** Resolves to a base64 PNG. Called only at upload time, so nothing is rendered or billed
   *  while the operator is still checking the destination. */
  getImageBase64: () => Promise<string>;
  /** Prefills the filename before the Quote is known. */
  fallbackName: string;
  /** No image generated yet. */
  disabled?: boolean;
}

export function SyncToSalesforce({ getImageBase64, fallbackName, disabled }: SyncToSalesforceProps) {
  const [open, setOpen] = useState(false);
  const [quoteInput, setQuoteInput] = useState("");
  const [manualFolderUrl, setManualFolderUrl] = useState("");
  const [target, setTarget] = useState<ResolvedTarget | null>(null);
  const [filename, setFilename] = useState("");
  const [linkToQuote, setLinkToQuote] = useState(true);
  const [busy, setBusy] = useState<"find" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  function reset() {
    setTarget(null);
    setResult(null);
    setError(null);
    setManualFolderUrl("");
  }

  async function find(boxFolderUrl?: string) {
    setError(null);
    setResult(null);
    setBusy("find");
    try {
      const res = await fetch("/api/salesforce/site-markup/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteInput, ...(boxFolderUrl ? { boxFolderUrl } : {}) }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; target?: ResolvedTarget; error?: string }
        | null;
      if (!res.ok || !json?.target) {
        setError(json?.error ?? "Couldn't look that Quote up.");
        setTarget(null);
        return;
      }
      setTarget(json.target);
      setFilename(json.target.suggestedFilename || fallbackName);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function upload() {
    if (!target?.folder) return;
    setError(null);
    setBusy("upload");
    try {
      const image = await getImageBase64();
      const res = await fetch("/api/salesforce/site-markup/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quoteId: target.quoteId,
          folderId: target.folder.id,
          filename,
          image,
          linkToQuote,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; result?: UploadResult; error?: string }
        | null;
      if (!res.ok || !json?.result) {
        setError(json?.error ?? "The upload failed.");
        return;
      }
      setResult(json.result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <button
        className={cn(buttonVariants({ variant: "accent", size: "md" }))}
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        Sync To Salesforce
      </button>
    );
  }

  return (
    <div className="mt-2 w-full max-w-xl rounded-xl border border-ad-border bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium text-ad-ink">Sync To Salesforce</p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="text-sm text-ad-muted hover:text-ad-ink"
        >
          Close
        </button>
      </div>

      <label className="mt-3 block text-sm font-medium text-ad-ink">
        Quote
        <input
          value={quoteInput}
          onChange={(e) => {
            setQuoteInput(e.target.value);
            reset();
          }}
          placeholder="Paste the Salesforce Quote URL"
          className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
        />
      </label>

      {!target && (
        <button
          className={cn(buttonVariants({ variant: "primary", size: "md" }), "mt-3")}
          onClick={() => find()}
          disabled={busy !== null || !quoteInput.trim()}
        >
          {busy === "find" ? "Looking up…" : "Find"}
        </button>
      )}

      {target && (
        <div className="mt-4 space-y-3 border-t border-ad-border pt-4 text-sm">
          <div className="space-y-1">
            <p className="text-ad-muted">
              Quote <span className="font-medium text-ad-ink">{target.quoteNumber ?? target.quoteId}</span>
            </p>
            <p className="text-ad-muted">
              Opportunity{" "}
              <span className="font-medium text-ad-ink">{target.opportunityName ?? "—"}</span>
            </p>
            {target.folder && (
              <p className="text-ad-muted">
                Saving to <span className="font-medium text-ad-ink">{target.folder.path}</span>
              </p>
            )}
          </div>

          {target.needsManualFolder && (
            <div className="rounded-lg border border-ad-orange/40 bg-ad-orange/5 p-3">
              <p className="text-ad-ink">
                No folder found — {target.missingStep}. Paste the Box folder you want the markup
                saved in.
              </p>
              <input
                value={manualFolderUrl}
                onChange={(e) => setManualFolderUrl(e.target.value)}
                placeholder="https://ausdilaps.app.box.com/folder/123456789"
                className="mt-2 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
              />
              <button
                className={cn(buttonVariants({ variant: "primary", size: "sm" }), "mt-2")}
                onClick={() => find(manualFolderUrl)}
                disabled={busy !== null || !manualFolderUrl.trim()}
              >
                {busy === "find" ? "Checking…" : "Use this folder"}
              </button>
            </div>
          )}

          {target.folder && !result && (
            <>
              <label className="block font-medium text-ad-ink">
                File name
                <input
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
                />
              </label>
              <label className="flex items-center gap-2 font-medium text-ad-ink">
                <input
                  type="checkbox"
                  checked={linkToQuote}
                  onChange={(e) => setLinkToQuote(e.target.checked)}
                  disabled={target.nextMarkupSlot === null}
                  className="h-4 w-4 rounded border-ad-border"
                />
                {target.nextMarkupSlot === null
                  ? `All ${target.markupSlotsTotal} Site Mark Up slots are full — upload only`
                  : `Link it to Site Mark Up ${target.nextMarkupSlot} (${target.markupSlotsUsed} of ${target.markupSlotsTotal} used)`}
              </label>
              <button
                className={cn(buttonVariants({ variant: "primary", size: "md" }))}
                onClick={upload}
                disabled={busy !== null || !filename.trim()}
              >
                {busy === "upload" ? "Uploading…" : "Upload to Box"}
              </button>
            </>
          )}
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-lg border border-ad-border bg-ad-surface p-3 text-sm">
          <p className="font-medium text-ad-ink">Saved {result.fileName}</p>
          {result.linkedToQuote ? (
            <p className="mt-1 text-ad-muted">
              Linked to Site Mark Up {result.markupSlot ?? ""} on the Quote.
            </p>
          ) : result.linkError ? (
            // Deliberately explicit: the file is filed, only the link failed, so the operator
            // knows not to re-upload.
            <p className="mt-1 text-ad-orange">
              Uploaded, but linking it to the Quote failed: {result.linkError}
            </p>
          ) : null}
          {(result.previewLink ?? result.sharedLink) && (
            <a
              // Preview page for the human. The direct link goes to Salesforce, where the
              // merge step needs bytes rather than Box's viewer.
              href={result.previewLink ?? result.sharedLink ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-ad-steel underline"
            >
              Open in Box
            </a>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-ad-orange">{error}</p>}
    </div>
  );
}
