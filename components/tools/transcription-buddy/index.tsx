"use client";

// Transcription Buddy — an inspector's MP3 dictation in, the transcript out, one Copy button.
//
// The transcript comes back in the SAME layout Word's Transcribe feature produces (Audio file /
// name / Transcript / hh:mm:ss lines), because that is what the report team's typing skill
// reads today. Shown cleaned by default — a Claude pass fixes plain mis-hearings only, never
// the inspector's wording — with a Show raw toggle so any fix can be checked against what was
// actually said. Several files can be dropped; they run one after another and Copy all hands
// back the whole batch the way the Word document laid it out.
//
// The audio never passes through our own routes: Vercel caps a function body at 4.5 MB and a
// ten-minute phone recording is twice that. The browser asks for a signed upload URL, PUTs the
// bytes straight to Supabase Storage, and the transcribe route hands Deepgram a link.

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useCopied } from "@/components/tools/shared/copy-text";
import {
  ACCEPTED_AUDIO_EXTENSIONS,
  DICTATION_BUCKET,
  MAX_AUDIO_BYTES,
} from "@/lib/transcription/config";
import { formatBatch } from "@/lib/transcription/format";

type Status = "queued" | "uploading" | "transcribing" | "done" | "failed";

type Item = {
  id: string;
  file: File;
  name: string;
  status: Status;
  raw?: string;
  cleaned?: string;
  cleanedChanged?: boolean;
  cleanupNote?: string | null;
  durationSeconds?: number;
  error?: string;
};

type TranscribeResponse = {
  ok: boolean;
  error?: string;
  raw?: string;
  cleaned?: string;
  cleanedChanged?: boolean;
  cleanupNote?: string | null;
  durationSeconds?: number;
};

const STATUS_LABEL: Record<Status, string> = {
  queued: "Queued",
  uploading: "Uploading…",
  transcribing: "Transcribing…",
  done: "Done",
  failed: "Failed",
};

function isAudio(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  const lower = file.name.toLowerCase();
  return ACCEPTED_AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function minutes(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m} min ${s} s` : `${s} s`;
}

/** Non-JSON bodies are what Vercel returns for 413/504 — the same handling Floor Plan uses. */
async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const json = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!json) {
    if (res.status === 504) throw new Error("The server gave up waiting. Try that file again.");
    throw new Error(`The server returned an unexpected response (HTTP ${res.status}).`);
  }
  if (!json.ok) throw new Error(json.error ?? fallback);
  return json;
}

export function TranscriptionBuddyTool() {
  const [items, setItems] = useState<Item[]>([]);
  const [view, setView] = useState<"cleaned" | "raw">("cleaned");
  const [dragActive, setDragActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { copied, failed, copy } = useCopied();

  // The processing loop reads the queue through a ref so files dropped mid-run join the end
  // of the same run rather than starting a second one beside it.
  const itemsRef = useRef<Item[]>([]);
  const running = useRef(false);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const patch = useCallback((id: string, changes: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)));
  }, []);

  const busy = items.some((it) => it.status === "uploading" || it.status === "transcribing");

  // The ticker only ever sets state from its interval callback — the React compiler lint
  // rejects a synchronous setState in an effect body, so the reset rides on the first tick.
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const tick = () => setElapsed(Math.round((Date.now() - start) / 1000));
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [busy]);

  const processOne = useCallback(
    async (item: Item) => {
      try {
        patch(item.id, { status: "uploading", error: undefined });
        const prep = await fetch("/api/transcription/upload-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: item.name, size: item.file.size, type: item.file.type }),
        });
        const { path, token } = await readJson<{ path: string; token: string }>(prep, "Could not prepare the upload.");

        // Straight to Storage on the signed URL — the bytes never touch a Vercel function.
        const { error: uploadError } = await createClient()
          .storage.from(DICTATION_BUCKET)
          .uploadToSignedUrl(path, token, item.file, { contentType: item.file.type || "audio/mpeg" });
        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

        patch(item.id, { status: "transcribing" });
        const res = await fetch("/api/transcription/transcribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path, name: item.name }),
        });
        const json = await readJson<TranscribeResponse>(res, "Transcription failed.");
        patch(item.id, {
          status: "done",
          raw: json.raw ?? "",
          cleaned: json.cleaned ?? json.raw ?? "",
          cleanedChanged: json.cleanedChanged ?? false,
          cleanupNote: json.cleanupNote ?? null,
          durationSeconds: json.durationSeconds ?? 0,
        });
      } catch (e) {
        patch(item.id, { status: "failed", error: (e as Error).message });
      }
    },
    [patch]
  );

  const runQueue = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = itemsRef.current.find((it) => it.status === "queued");
        if (!next) break;
        await processOne(next);
      }
    } finally {
      running.current = false;
    }
  }, [processOne]);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const fresh: Item[] = [];
      for (const file of Array.from(files)) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        if (!isAudio(file)) {
          fresh.push({ id, file, name: file.name, status: "failed", error: "Not an audio file." });
        } else if (file.size > MAX_AUDIO_BYTES) {
          fresh.push({ id, file, name: file.name, status: "failed", error: `Too large (${mb(file.size)}; ${mb(MAX_AUDIO_BYTES)} max).` });
        } else {
          fresh.push({ id, file, name: file.name, status: "queued" });
        }
      }
      if (!fresh.length) return;
      // Update the ref synchronously too: runQueue() reads it in the same tick, before the
      // state above has rendered.
      itemsRef.current = [...itemsRef.current, ...fresh];
      setItems(itemsRef.current);
      void runQueue();
    },
    [runQueue]
  );

  const retry = useCallback(
    (id: string) => {
      itemsRef.current = itemsRef.current.map((it) => (it.id === id ? { ...it, status: "queued", error: undefined } : it));
      setItems(itemsRef.current);
      void runQueue();
    },
    [runQueue]
  );

  const done = items.filter((it) => it.status === "done");
  const textFor = (it: Item) => (view === "raw" ? it.raw : it.cleaned) ?? "";
  const output = formatBatch(done.map(textFor));
  const anyCleaned = done.some((it) => it.cleanedChanged);
  const cleanupNote = done.find((it) => it.cleanupNote)?.cleanupNote ?? null;

  const copyRow = async (it: Item) => {
    await copy(textFor(it));
    setCopiedId(it.id);
    setTimeout(() => setCopiedId((cur) => (cur === it.id ? null : cur)), 1500);
  };

  return (
    <div>
      {/* Drop zone — compact once the queue has something in it. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileInput.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-center transition-colors",
          items.length ? "p-5" : "p-10",
          dragActive ? "border-ad-orange bg-ad-orange/10" : "border-ad-border hover:bg-ad-surface"
        )}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={[...ACCEPTED_AUDIO_EXTENSIONS, "audio/*"].join(",")}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="font-medium text-ad-ink">
          {dragActive ? "Drop the recording here" : "Drag & drop the inspector's MP3 here, or click to browse"}
        </p>
        {!items.length && (
          <p className="max-w-md text-sm text-ad-muted">
            Several files at once is fine — they run one after another. A 15-minute dictation takes about a minute.
          </p>
        )}
      </div>

      {items.length > 0 && (
        <>
          {/* Toolbar sits ABOVE the output, so it is reachable while the transcript is scrolled. */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={cn(buttonVariants({ variant: "primary", size: "md" }))}
              disabled={!output}
              onClick={() => void copy(output)}
            >
              {copied ? "Copied" : failed ? "Copy failed" : done.length > 1 ? "Copy all" : "Copy"}
            </button>
            <button
              type="button"
              className={cn(buttonVariants({ variant: "outline", size: "md" }))}
              disabled={!done.length}
              onClick={() => setView((v) => (v === "raw" ? "cleaned" : "raw"))}
            >
              {view === "raw" ? "Show cleaned" : "Show raw"}
            </button>
            <button
              type="button"
              className={cn(buttonVariants({ variant: "outline", size: "md" }))}
              disabled={busy}
              onClick={() => {
                itemsRef.current = [];
                setItems([]);
              }}
            >
              Clear
            </button>
            {busy && (
              <span className="text-sm text-ad-muted">
                Working… {elapsed}s
              </span>
            )}
          </div>

          <p className="mt-2 text-sm text-ad-muted">
            {cleanupNote
              ? cleanupNote
              : view === "raw"
                ? "Raw: exactly what the transcriber heard."
                : anyCleaned
                  ? "Cleaned: obvious mis-hearings fixed (yard, tile floors, room numbers). Switch to raw to check a fix."
                  : done.length
                    ? "Cleaned: nothing needed fixing."
                    : "Cleaned view fixes obvious mis-hearings; switch to raw to check a fix."}
          </p>

          {/* The queue */}
          <ul className="mt-4 divide-y divide-ad-border rounded-xl border border-ad-border text-sm">
            {items.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate font-medium text-ad-ink" title={it.name}>
                  {it.name}
                </span>
                <span className="text-ad-muted">{mb(it.file.size)}</span>
                {it.status === "done" && it.durationSeconds ? (
                  <span className="text-ad-muted">{minutes(it.durationSeconds)}</span>
                ) : null}
                <span
                  className={cn(
                    it.status === "failed" ? "text-ad-orange" : it.status === "done" ? "text-ad-steel" : "text-ad-muted"
                  )}
                >
                  {STATUS_LABEL[it.status]}
                </span>
                {it.status === "done" && (
                  <button
                    type="button"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    onClick={() => void copyRow(it)}
                  >
                    {copiedId === it.id ? "Copied" : "Copy"}
                  </button>
                )}
                {it.status === "failed" && it.error !== "Not an audio file." && !it.error?.startsWith("Too large") && (
                  <button
                    type="button"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    disabled={busy}
                    onClick={() => retry(it.id)}
                  >
                    Retry
                  </button>
                )}
                {it.error && <span className="basis-full text-ad-orange">{it.error}</span>}
              </li>
            ))}
          </ul>

          {/* The output — for checking. Copy is the way it leaves the page. */}
          <textarea
            readOnly
            value={output}
            placeholder={busy ? "The transcript appears here once the first file is done." : ""}
            className="mt-4 h-[60vh] w-full resize-y rounded-xl border border-ad-border bg-white p-4 font-mono text-sm leading-relaxed text-ad-ink focus:outline-none focus:ring-2 focus:ring-ad-accent"
          />
        </>
      )}
    </div>
  );
}
