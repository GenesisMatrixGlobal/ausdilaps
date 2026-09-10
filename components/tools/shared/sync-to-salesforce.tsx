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
import { levelsUnchecked, type LineItemRow } from "@/lib/markup-layers/line-items";
import { rowReason, type Refusal } from "@/lib/quote-lines/payload";

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
  lineItem: { id: string; label: string; alreadyFilled: boolean } | null;
}

interface UploadResult {
  fileId: string;
  fileName: string;
  sharedLink: string | null;
  previewLink?: string | null;
  linkedToQuote: boolean;
  linkError?: string;
  markupSlot?: number;
  linkedToLineItem?: boolean;
  replacedExistingLink?: boolean;
  sidecarFileName?: string;
  sidecarError?: string;
}

export interface SyncToSalesforceProps {
  /** Resolves to a base64 PNG. Called only at upload time, so nothing is rendered or billed
   *  while the operator is still checking the destination. */
  getImageBase64: () => Promise<string>;
  /** Prefills the filename before the Quote is known. */
  fallbackName: string;
  /** No image generated yet. */
  disabled?: boolean;
  /** The editable source for the image, filed beside the PNG so whoever picks the job up
   *  can reopen and adjust it instead of redrawing from a flattened image. Given the
   *  confirmed PNG filename (extension included) so the pair share a stem in Box. Omit on
   *  a tool that has nothing reopenable to save. */
  getSidecar?: (imageFilename: string) => Promise<{ filename: string; contentBase64: string; contentType?: string }>;
  /** The Quote Line Item sheet's rows. When given, the same sync also creates one QuoteLineItem
   *  per TICKED row on the Quote (opt-out with a checkbox) — one paste does the whole job.
   *  Rows that can't sync are listed and block the create until fixed or unticked. */
  lineItems?: { rows: LineItemRow[] };
}

interface LinesResult {
  created: { key: string; id: string }[];
  quoteUrl: string | null;
}

export function SyncToSalesforce({
  getImageBase64,
  fallbackName,
  disabled,
  getSidecar,
  lineItems,
}: SyncToSalesforceProps) {
  const [open, setOpen] = useState(false);
  const [quoteInput, setQuoteInput] = useState("");
  const [manualFolderUrl, setManualFolderUrl] = useState("");
  const [target, setTarget] = useState<ResolvedTarget | null>(null);
  const [filename, setFilename] = useState("");
  const [linkToQuote, setLinkToQuote] = useState(true);
  const [busy, setBusy] = useState<"find" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [createLines, setCreateLines] = useState(true);
  const [linesResult, setLinesResult] = useState<LinesResult | null>(null);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [linesRefused, setLinesRefused] = useState<Refusal[]>([]);

  const ticked = lineItems?.rows.filter((r) => r.selected) ?? [];
  const blocked = ticked
    .map((r) => ({ row: r, reason: rowReason(r.values) }))
    .filter((x): x is { row: LineItemRow; reason: string } => x.reason !== null);
  const linesReady = ticked.length - blocked.length;
  const wantLines = !!lineItems && createLines && ticked.length > 0;
  // No line items go to the Quote while a ticked row's Levels cell is still orange.
  const unchecked = wantLines ? ticked.filter(levelsUnchecked).length : 0;

  function reset() {
    setTarget(null);
    setResult(null);
    setError(null);
    setManualFolderUrl("");
    setLinesResult(null);
    setLinesError(null);
    setLinesRefused([]);
  }

  /** One QuoteLineItem per ticked row, all or nothing — see lib/quote-lines/payload.ts. Runs
   *  after the PNG is filed; a failure here is reported beside the upload result, never as a
   *  reason to re-upload. */
  async function createLineItems(quoteId: string) {
    setLinesError(null);
    setLinesRefused([]);
    try {
      const res = await fetch("/api/salesforce/quote-lines/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId, rows: ticked.map((r) => ({ key: r.key, values: r.values })) }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; result?: LinesResult; refused?: Refusal[]; error?: string }
        | null;
      if (!res.ok || !json?.result) {
        setLinesError(json?.error ?? "Creating the line items failed.");
        setLinesRefused(json?.refused ?? []);
        return;
      }
      setLinesResult(json.result);
    } catch (e) {
      setLinesError((e as Error).message);
    }
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
      // Linking is opt-IN when it would overwrite something. Everywhere else it stays the
      // default, because linking is the point of the button.
      setLinkToQuote(!json.target.lineItem?.alreadyFilled);
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
      const sidecar = getSidecar ? await getSidecar(filename) : undefined;
      const res = await fetch("/api/salesforce/site-markup/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quoteId: target.quoteId,
          folderId: target.folder.id,
          filename,
          image,
          linkToQuote,
          // Present only for a line-item paste; the server then writes to the line item's
          // own field instead of a Quote slot.
          ...(target.lineItem
            ? {
                lineItemId: target.lineItem.id,
                // Ticking the box on an occupied field IS the authorisation to replace.
                replaceExistingLink: target.lineItem.alreadyFilled && linkToQuote,
              }
            : {}),
          ...(sidecar ? { sidecar } : {}),
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
      if (wantLines) await createLineItems(target.quoteId);
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
    // Full width of the toolbar's block: it wraps onto its own line under the buttons, and at
    // half width it read as an afterthought beside them.
    <div className="mt-2 w-full rounded-xl border border-ad-border bg-white p-5">
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
          placeholder="Paste the Salesforce Quote or Quote Line Item URL"
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
            {target.lineItem && (
              <p className="text-ad-muted">
                Line item <span className="font-medium text-ad-ink">{target.lineItem.label}</span>
              </p>
            )}
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
                  // A line item's single field can be replaced with a tick, unlike the
                  // Quote's five slots, where a full set means clearing one by hand — there
                  // is no way to know WHICH of five a new drawing should displace.
                  disabled={!target.lineItem && target.nextMarkupSlot === null}
                  className="h-4 w-4 rounded border-ad-border"
                />
                {target.lineItem
                  ? target.lineItem.alreadyFilled
                    ? "Replace the markup already linked to this line item"
                    : "Link it to the line item's Line Item Mark Up field"
                  : target.nextMarkupSlot === null
                    ? `All ${target.markupSlotsTotal} Site Mark Up slots are full — upload only`
                    : `Link it to Site Mark Up ${target.nextMarkupSlot} (${target.markupSlotsUsed} of ${target.markupSlotsTotal} used)`}
              </label>
              {lineItems && (
                <div className="space-y-1">
                  <label className="flex items-center gap-2 font-medium text-ad-ink">
                    <input
                      type="checkbox"
                      checked={createLines}
                      onChange={(e) => setCreateLines(e.target.checked)}
                      disabled={ticked.length === 0}
                      className="h-4 w-4 rounded border-ad-border"
                    />
                    {ticked.length === 0
                      ? "No sheet rows are ticked — nothing to create on the Quote"
                      : `Create ${linesReady} quote line item${linesReady === 1 ? "" : "s"} from the ticked rows`}
                  </label>
                  {createLines && blocked.length > 0 && (
                    <ul className="list-disc pl-9 text-ad-orange">
                      {blocked.map(({ row, reason }) => (
                        <li key={row.key}>
                          {row.number !== null ? `${row.number} · ` : ""}
                          {row.values.street || row.source.label}: {reason} — fix or untick it
                        </li>
                      ))}
                    </ul>
                  )}
                  {unchecked > 0 && (
                    <p className="pl-6 text-ad-orange">
                      Check the {unchecked} highlighted Levels cell{unchecked === 1 ? "" : "s"} on the sheet first — click each one to confirm the storey count.
                    </p>
                  )}
                  <p className="pl-6 text-xs text-ad-muted">
                    Unit price goes in as a $1 placeholder — pricing is finalised in Salesforce.
                  </p>
                </div>
              )}
              <button
                className={cn(buttonVariants({ variant: "primary", size: "md" }))}
                onClick={upload}
                disabled={busy !== null || !filename.trim() || (wantLines && (blocked.length > 0 || unchecked > 0))}
                title={
                  unchecked > 0
                    ? "Click each highlighted Levels cell on the sheet to confirm it, or untick 'Create line items'"
                    : wantLines && blocked.length > 0
                      ? "Untick or fix the rows that can't sync, or untick 'Create line items'"
                      : undefined
                }
              >
                {busy === "upload" ? (wantLines ? "Uploading and creating…" : "Uploading…") : wantLines ? "Upload and create line items" : "Upload to Box"}
              </button>
            </>
          )}
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-lg border border-ad-border bg-ad-surface p-3 text-sm">
          {/* The name Box actually gave it. uploadMarkup steps a clashing name to " (2)"
              rather than stopping to ask, so this is where a rename becomes visible. */}
          <p className="font-medium text-ad-ink">Saved {result.fileName}</p>
          {result.fileName !== filename.trim() && (
            <p className="mt-1 text-ad-muted">
              A file called {filename.trim()} was already in that folder, so this one was
              renamed.
            </p>
          )}
          {result.linkedToQuote ? (
            <p className="mt-1 text-ad-muted">
              {result.linkedToLineItem
                ? result.replacedExistingLink
                  ? "Replaced the line item's Line Item Mark Up link."
                  : "Linked to the line item's Line Item Mark Up field."
                : `Linked to Site Mark Up ${result.markupSlot ?? ""} on the Quote.`}
            </p>
          ) : result.linkError ? (
            // Deliberately explicit: the file is filed, only the link failed, so the operator
            // knows not to re-upload.
            <p className="mt-1 text-ad-orange">
              Uploaded, but linking it to the Quote failed: {result.linkError}
            </p>
          ) : null}
          {result.sidecarFileName && (
            <p className="mt-1 text-ad-muted">
              Saved {result.sidecarFileName} beside it — open that to adjust the markup later.
            </p>
          )}
          {result.sidecarError && (
            // The PNG is filed and possibly linked; only the editable copy failed. Say so
            // precisely, or the operator re-uploads a markup that is already correct.
            <p className="mt-1 text-ad-orange">
              The markup is saved, but its editable .json copy failed: {result.sidecarError}
            </p>
          )}
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
          {linesResult && (
            <p className="mt-2 border-t border-ad-border pt-2 text-ad-ink">
              Created {linesResult.created.length} quote line item{linesResult.created.length === 1 ? "" : "s"} on the Quote.
              {linesResult.quoteUrl && (
                <>
                  {" "}
                  <a href={linesResult.quoteUrl} target="_blank" rel="noreferrer" className="text-ad-steel underline">
                    Open the Quote
                  </a>
                </>
              )}
            </p>
          )}
          {linesError && (
            // The PNG is filed; only the line items failed. Said precisely so the operator does
            // not re-upload the image to retry the lines.
            <div className="mt-2 border-t border-ad-border pt-2 text-ad-orange">
              <p>The markup is filed, but creating the line items failed: {linesError}</p>
              {linesRefused.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {linesRefused.map((r) => (
                    <li key={r.key}>
                      {r.street || r.key}: {r.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-ad-orange">{error}</p>}
    </div>
  );
}
