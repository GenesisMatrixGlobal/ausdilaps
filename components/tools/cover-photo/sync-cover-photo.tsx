"use client";

// "Send to Salesforce" for the Cover Photo Generator.
//
// A small sibling of components/tools/shared/sync-to-salesforce.tsx rather than a mode of it:
// that one carries Quote numbers, five numbered markup slots, Quote Line Items, a .json
// companion and the quote-lines clear. A Survey has ONE field and none of the rest, so the
// simple case is cheaper to write than to thread through.
//
// Two steps on purpose — find, then confirm — so the Survey and its Opportunity are on screen
// before anything is written to Box or Salesforce. Filing a report's cover photo against the
// wrong job is invisible once it has happened.

import { useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

interface ResolvedSurvey {
  surveyId: string;
  surveyName: string | null;
  opportunityName: string | null;
  boxFolderLink: string | null;
  folder: { id: string; path: string } | null;
  needsManualFolder: boolean;
  missingStep?: string;
  suggestedFilename: string;
  alreadyFilled: boolean;
}

interface UploadResult {
  fileId: string;
  fileName: string;
  sharedLink: string | null;
  previewLink?: string | null;
  linkedToSurvey: boolean;
  linkError?: string;
  replacedExistingLink?: boolean;
}

export function SyncCoverPhoto({
  getImageBase64,
  disabled,
}: {
  /** Resolves to a base64 PNG. Called only at upload time, so nothing is rendered or billed
   *  while the operator is still checking the destination. */
  getImageBase64: () => Promise<string>;
  /** No cover photo to send yet. */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [surveyInput, setSurveyInput] = useState("");
  const [manualFolderUrl, setManualFolderUrl] = useState("");
  const [target, setTarget] = useState<ResolvedSurvey | null>(null);
  const [filename, setFilename] = useState("");
  const [linkToSurvey, setLinkToSurvey] = useState(true);
  const [busy, setBusy] = useState<"find" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  function reset() {
    setTarget(null);
    setResult(null);
    setError(null);
    setManualFolderUrl("");
  }

  async function find(folderUrl?: string) {
    setBusy("find");
    setError(null);
    try {
      const res = await fetch("/api/salesforce/cover-photo/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surveyInput, boxFolderUrl: folderUrl }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Couldn't find that Survey.");
        setTarget(null);
        return;
      }
      setTarget(json.target);
      setFilename(json.target.suggestedFilename);
      // Linking is opt-IN wherever it would overwrite something, and the default everywhere
      // else — linking is the point of the button.
      setLinkToSurvey(!json.target.alreadyFilled);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function upload() {
    if (!target?.folder) return;
    setBusy("upload");
    setError(null);
    try {
      const image = await getImageBase64();
      const res = await fetch("/api/salesforce/cover-photo/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surveyId: target.surveyId,
          folderId: target.folder.id,
          filename: filename.trim(),
          image,
          linkToSurvey,
          // Only ever true when the operator ticked the box on an occupied field. The server
          // re-reads the field at write time and refuses without it.
          replaceExistingLink: linkToSurvey && target.alreadyFilled,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "The upload failed.");
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
        Send to Salesforce
      </button>
    );
  }

  return (
    <div className="mt-2 w-full rounded-xl border border-ad-border bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium text-ad-ink">Send to Salesforce</p>
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
        Survey
        <input
          value={surveyInput}
          onChange={(e) => {
            setSurveyInput(e.target.value);
            reset();
          }}
          placeholder="Paste the Salesforce Survey URL"
          className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm text-ad-ink outline-none focus:border-ad-steel"
        />
      </label>

      {!target && (
        <button
          className={cn(buttonVariants({ variant: "primary", size: "md" }), "mt-3")}
          onClick={() => find()}
          disabled={busy !== null || !surveyInput.trim()}
        >
          {busy === "find" ? "Looking up…" : "Find"}
        </button>
      )}

      {target && (
        <div className="mt-4 space-y-3 border-t border-ad-border pt-4 text-sm">
          <div className="space-y-1">
            <p className="text-ad-muted">
              Survey <span className="font-medium text-ad-ink">{target.surveyName ?? target.surveyId}</span>
            </p>
            <p className="text-ad-muted">
              Opportunity <span className="font-medium text-ad-ink">{target.opportunityName ?? "—"}</span>
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
                No folder found — {target.missingStep}. Paste the Box folder you want the cover
                photo saved in.
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
              <label className="flex items-start gap-2 font-medium text-ad-ink">
                <input
                  type="checkbox"
                  checked={linkToSurvey}
                  onChange={(e) => setLinkToSurvey(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-ad-border"
                />
                {target.alreadyFilled
                  ? "Replace the cover photo already linked to this Survey"
                  : "Link it to the Survey's Cover Photo URL field"}
              </label>
              {target.alreadyFilled && linkToSurvey && (
                <p className="pl-6 text-xs text-ad-muted">
                  The photo already on the Survey stays in Box — only the link is replaced.
                </p>
              )}
              <button
                className={cn(buttonVariants({ variant: "accent", size: "md" }))}
                onClick={upload}
                disabled={busy !== null || !filename.trim()}
              >
                {busy === "upload" ? "Uploading…" : "Upload"}
              </button>
            </>
          )}
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-lg border border-ad-border bg-ad-surface p-3 text-sm">
          {/* The name Box actually gave it. A clashing name is stepped to " (2)" rather than
              stopping to ask, so this is where a rename becomes visible. */}
          <p className="font-medium text-ad-ink">Saved {result.fileName}</p>
          {result.fileName !== filename.trim() && (
            <p className="mt-1 text-ad-muted">
              A file called {filename.trim()} was already in that folder, so this one was renamed.
            </p>
          )}
          {result.linkedToSurvey ? (
            <p className="mt-1 text-ad-muted">
              {result.replacedExistingLink
                ? "Replaced the Survey's Cover Photo URL."
                : "Linked to the Survey's Cover Photo URL field."}
            </p>
          ) : result.linkError ? (
            // Deliberately explicit: the file is filed, only the link failed, so the operator
            // knows not to re-upload.
            <p className="mt-1 text-ad-orange">
              Uploaded, but linking it to the Survey failed: {result.linkError}
            </p>
          ) : null}
          {(result.previewLink ?? result.sharedLink) && (
            <a
              // Preview page for the human. The direct link goes to Salesforce, where the merge
              // step needs bytes rather than Box's viewer.
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
