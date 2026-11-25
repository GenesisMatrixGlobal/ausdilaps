"use client";

import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_TOTAL_BYTES,
  UPLOAD_ACCEPT,
  UPLOAD_HINT,
  UPLOAD_KINDS,
  formatBytes,
  uploadTypeFor,
} from "@/lib/enquiry-uploads-options";

/** A message that is safe to show the visitor as-is. */
export class UploadError extends Error {}

/**
 * Phone photos are 3–8 MB each; five of them would blow the total and take a minute on 4G.
 * A big JPEG is redrawn at 2560px on its long edge, which is ~1 MB and still plenty to see
 * a crack in. Anything that goes wrong returns the original untouched.
 */
async function shrinkPhoto(file: File): Promise<File> {
  if (file.type !== "image/jpeg" || file.size < 2 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/**
 * Sends the files to storage ahead of the form itself. Returns what /api/quote needs to
 * find them again. The Turnstile token is spent here — the ticket stands in for it after.
 */
export async function uploadAttachments(
  files: File[],
  turnstileToken: string
): Promise<{ uploadId: string; uploadTicket: string }> {
  const res = await fetch("/api/quote/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnstileToken, files: files.map((f) => ({ name: f.name, size: f.size })) }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new UploadError(data?.error ?? "We couldn’t attach your files. Please try again.");
  }
  const slots = data.uploads as { signedUrl: string; contentType: string }[];
  await Promise.all(
    slots.map(async (slot, i) => {
      const put = await fetch(slot.signedUrl, {
        method: "PUT",
        headers: { "content-type": slot.contentType, "x-upsert": "false" },
        body: files[i],
      }).catch(() => null);
      if (!put?.ok) {
        throw new UploadError(`We couldn’t upload ${files[i].name}. Check your connection and try again, or remove it and send without.`);
      }
    })
  );
  return { uploadId: data.uploadId, uploadTicket: data.ticket };
}

/** "Attachments" on the enquiry form: pick PDFs or photos, see them listed, remove any. */
export function AttachmentsField({
  files,
  onChange,
  labelClassName,
  className,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  labelClassName: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function add(picked: File[]) {
    setError("");
    const problems: string[] = [];
    let tooBig = false;
    const next = [...files];
    setPreparing(true);
    for (const original of picked) {
      if (next.some((f) => f.name === original.name && f.lastModified === original.lastModified)) continue;
      if (!uploadTypeFor(original.name)) {
        problems.push(`${original.name} can’t be attached. Use a ${UPLOAD_KINDS} file.`);
        continue;
      }
      if (next.length >= MAX_UPLOAD_FILES) {
        problems.push(`Only ${MAX_UPLOAD_FILES} files can be attached.`);
        break;
      }
      const file = await shrinkPhoto(original);
      if (file.size > MAX_UPLOAD_FILE_BYTES) {
        problems.push(`${file.name} is over 10 MB.`);
        tooBig = true;
        continue;
      }
      if (next.reduce((sum, f) => sum + f.size, file.size) > MAX_UPLOAD_TOTAL_BYTES) {
        problems.push(`${file.name} takes the total over 20 MB.`);
        tooBig = true;
        continue;
      }
      next.push(file);
    }
    setPreparing(false);
    if (tooBig) problems.push("Email larger files to info@ausdilaps.com.au.");
    setError(problems.join(" "));
    onChange(next);
  }

  return (
    // The whole field is the drop target, so a file dropped on the list or the hint lands too.
    <div
      className={className}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        // Fires when the pointer crosses onto a child as well; only a real exit counts.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(false);
        void add(Array.from(e.dataTransfer.files));
      }}
    >
      <span className={labelClassName}>
        Attachments <span className="font-normal text-ad-muted">(optional)</span>
      </span>
      <p id="attachments-hint" className="mt-1 text-xs text-ad-muted">
        Plans, a marked-up map or photos of the area. {UPLOAD_HINT}
      </p>

      {files.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {files.map((f) => (
            <li
              key={`${f.name}-${f.lastModified}`}
              className="flex items-center gap-2 rounded-md border border-ad-border bg-ad-surface/60 py-1.5 pl-3 pr-1.5 text-sm text-ad-ink"
            >
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 text-xs text-ad-muted">{formatBytes(f.size)}</span>
              <button
                type="button"
                onClick={() => {
                  setError("");
                  onChange(files.filter((x) => x !== f));
                }}
                className="shrink-0 rounded p-1 text-ad-muted hover:bg-ad-border/50 hover:text-ad-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ad-accent"
                aria-label={`Remove ${f.name}`}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          // Cleared so picking the same file again after removing it still fires a change.
          e.target.value = "";
          void add(picked);
        }}
      />
      {files.length < MAX_UPLOAD_FILES && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={preparing}
          aria-describedby="attachments-hint"
          className={cn(
            "mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-4 py-3 text-sm font-medium text-ad-accent transition-colors hover:border-ad-accent hover:bg-ad-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ad-accent/40",
            dragging ? "border-ad-accent bg-ad-accent/10" : "border-ad-accent/50 bg-white",
            preparing && "opacity-70"
          )}
        >
          <Paperclip className="h-4 w-4 shrink-0" aria-hidden="true" />
          {preparing ? (
            "Adding…"
          ) : dragging ? (
            "Drop to attach"
          ) : (
            <span>
              {files.length > 0 ? "Add another file" : "Add files"}
              {/* A phone has nothing to drag, so the prompt is desktop-only. */}
              <span className="hidden font-normal text-ad-muted lg:inline"> or drag them here</span>
            </span>
          )}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-ad-orange">
          {error}
        </p>
      )}
    </div>
  );
}
