"use client";

// Transcription Buddy — an inspector's dictation, read from Box, the transcript out, one Copy.
//
// The transcript comes back in the SAME layout Word's Transcribe feature produces (Audio file /
// name / Transcript / hh:mm:ss lines), because that is what the report team's typing skill
// reads today. Three views of the same recording, and Copy takes whichever is showing:
//   For typing — the default. The greeting, weather, sign-off, door-knock preamble and fillers
//                stripped by a deterministic rule set (lib/transcription/trim.ts); what is
//                left is the figures, which is all the typing skill reads.
//   Cleaned    — every line, with a Claude pass fixing plain mis-hearings only.
//   Raw        — exactly what the transcriber heard, for checking either of the above.
//
// BOX LINKS ONLY (2026-09-23, Rhys). The recordings already live in Box, so the tool reads them
// there: paste file or folder links, a folder becomes every recording in it, and Box hands
// Deepgram a download URL. Nothing is uploaded, nothing is copied, no size cap of ours applies,
// and a queue of dozens runs three at a time with Stop and Resume. The drag-and-drop path and
// its Storage bucket were removed with this — the upload was the slow part.

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useCopied } from "@/components/tools/shared/copy-text";
import { formatCents } from "@/lib/format-cents";
import { extractBoxLinks } from "@/lib/transcription/box-link";
import { formatBatch } from "@/lib/transcription/format";
import { countFlags } from "@/lib/transcription/trim";

type Status = "queued" | "transcribing" | "done" | "failed";

type View = "typing" | "cleaned" | "raw";

const VIEWS: { key: View; label: string }[] = [
  { key: "typing", label: "For typing" },
  { key: "cleaned", label: "Cleaned" },
  { key: "raw", label: "Raw" },
];

type Item = {
  id: string;
  fileId: string;
  /** The shared link the file was reached through, when the account has no direct access. */
  sharedUrl?: string;
  size: number;
  name: string;
  status: Status;
  raw?: string;
  cleaned?: string;
  /** The cleaned transcript with the non-figure lines stripped — see lib/transcription/trim.ts. */
  typing?: string;
  typingRemoved?: number;
  cleanedChanged?: boolean;
  cleanupNote?: string | null;
  durationSeconds?: number;
  /** What this file cost at list (Deepgram + the clean-up), from the route — the same figure
   *  its api_calls rows carry. */
  costCents?: number;
  error?: string;
};

type TranscribeResponse = {
  ok: boolean;
  error?: string;
  /** From /from-box only: Box's own file name and size. */
  name?: string;
  size?: number;
  raw?: string;
  cleaned?: string;
  typing?: string;
  typingRemoved?: number;
  cleanedChanged?: boolean;
  cleanupNote?: string | null;
  durationSeconds?: number;
  costCents?: number;
};

/**
 * How many files are transcribed at once.
 *
 * It was strictly one at a time, which for a single dictation is the right answer and for a real
 * batch is not: 27 recordings at ~20 s each is nine minutes of staring at a queue. Deepgram's
 * pre-recorded API takes concurrent jobs happily, and the work is all waiting on somebody else's
 * server — the same reasoning as the parcel pool (5) and the bulk address pages (3) elsewhere.
 *
 * ⚠️ Three, not thirty. Each one in flight holds a Vercel function (`maxDuration = 290`), a
 * Deepgram job and an Anthropic cleanup pass, and the ceiling that matters is somebody else's
 * rate limit, not our patience.
 */
const BATCH_CONCURRENCY = 3;

/** Failures in a row before the batch stops itself — see the note in `worker`. */
const MAX_CONSECUTIVE_FAILURES = 3;

const STATUS_LABEL: Record<Status, string> = {
  queued: "Queued",
  transcribing: "Transcribing…",
  done: "Done",
  failed: "Failed",
};

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
  const [view, setView] = useState<View>("typing");
  const [elapsed, setElapsed] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { copied, failed, copy } = useCopied();

  // ⚠️ The REF is the queue; `items` only mirrors it for rendering. Every mutation writes the
  // ref synchronously and then hands the same array to setItems.
  //
  // That used to be the other way round — setItems with a functional update, and an effect
  // copying `items` back into the ref. Fine for one worker, a DOUBLE-TRANSCRIBE with several:
  // React had not re-rendered yet, so two workers calling find() in the same tick both saw the
  // same file still "queued" and both paid for it.
  const itemsRef = useRef<Item[]>([]);
  const running = useRef(false);
  /** Trips the circuit breaker below. Reset by any success. */
  const consecutiveFailures = useRef(0);
  /** Stop: workers finish the file in hand and claim no more. Resume runs the queue again. */
  const stopRequested = useRef(false);
  /** Mirror of the ref for the toolbar — a ref may not be read during render. */
  const [stopping, setStopping] = useState(false);
  const [halted, setHalted] = useState<string | null>(null);

  const patch = useCallback((id: string, changes: Partial<Item>) => {
    itemsRef.current = itemsRef.current.map((it) => (it.id === id ? { ...it, ...changes } : it));
    setItems(itemsRef.current);
  }, []);

  const busy = items.some((it) => it.status === "transcribing");

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
        const res = await fetch("/api/transcription/from-box", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fileId: item.fileId, sharedUrl: item.sharedUrl }),
        });
        const json = await readJson<TranscribeResponse>(res, "Transcription failed.");
        patch(item.id, {
          status: "done",
          name: json.name ?? item.name,
          size: json.size ?? item.size,
          raw: json.raw ?? "",
          cleaned: json.cleaned ?? json.raw ?? "",
          typing: json.typing ?? json.cleaned ?? json.raw ?? "",
          typingRemoved: json.typingRemoved ?? 0,
          cleanedChanged: json.cleanedChanged ?? false,
          cleanupNote: json.cleanupNote ?? null,
          durationSeconds: json.durationSeconds ?? 0,
          costCents: json.costCents ?? 0,
        });
        consecutiveFailures.current = 0;
      } catch (e) {
        patch(item.id, { status: "failed", error: (e as Error).message });
        consecutiveFailures.current += 1;
      }
    },
    [patch]
  );

  const runQueue = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    consecutiveFailures.current = 0;
    stopRequested.current = false;
    setStopping(false);
    setHalted(null);
    try {
      /** Take the next queued file and mark it taken IN THE SAME TICK — see the ref note above. */
      const claim = (): Item | null => {
        const next = itemsRef.current.find((it) => it.status === "queued");
        if (!next) return null;
        patch(next.id, { status: "transcribing", error: undefined });
        return next;
      };

      const worker = async () => {
        for (;;) {
          // ⚠️ A run of failures STOPS the batch. Without this, a wrong Deepgram key or an
          // account out of credit fails all 27 files one at a time and you come back to 27
          // identical errors.
          if (consecutiveFailures.current >= MAX_CONSECUTIVE_FAILURES || stopRequested.current) return;
          const next = claim();
          if (!next) return;
          await processOne(next);
        }
      };

      await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, worker));

      const stillQueued = itemsRef.current.filter((it) => it.status === "queued").length;
      if (consecutiveFailures.current >= MAX_CONSECUTIVE_FAILURES) {
        setHalted(
          `Stopped after ${MAX_CONSECUTIVE_FAILURES} failures in a row${stillQueued ? `, with ${stillQueued} still to go` : ""}. ` +
            `Read the error below — it is the same for all of them — then press Resume.`
        );
      } else if (stopRequested.current && stillQueued) {
        setHalted(`Stopped, with ${stillQueued} still queued. Press Resume to carry on, or Clear to drop them.`);
      }
    } finally {
      running.current = false;
    }
  }, [patch, processOne]);

  const [linkText, setLinkText] = useState("");
  const [adding, setAdding] = useState(false);
  const [intakeNote, setIntakeNote] = useState<string | null>(null);

  /** Every Box link in the box → asked of Box what it holds → queued. A folder becomes every
   *  recording in it; a file already in the queue is not added twice. Listing is free; the
   *  queue starts as soon as the first link resolves. */
  const addLinks = useCallback(async () => {
    const links = extractBoxLinks(linkText);
    if (!links.length) {
      setIntakeNote("No Box links found. Paste links like …box.com/file/123456 or …box.com/folder/123456, one per line.");
      return;
    }
    setAdding(true);
    setIntakeNote(null);
    const notes: string[] = [];
    let added = 0;
    for (const url of links) {
      try {
        const res = await fetch("/api/transcription/box-list", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const listed = await readJson<{ kind: "file" | "folder"; folderName?: string; files: { fileId: string; name: string; size: number; sharedUrl?: string }[] }>(
          res,
          "Could not read that Box link."
        );
        const known = new Set(itemsRef.current.map((it) => it.fileId));
        const fresh: Item[] = listed.files
          .filter((f) => !known.has(f.fileId))
          .map((f) => ({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            fileId: f.fileId,
            sharedUrl: f.sharedUrl,
            name: f.name,
            size: f.size,
            status: "queued" as const,
          }));
        if (listed.kind === "folder") {
          notes.push(
            listed.files.length === 0
              ? `"${listed.folderName}" has no audio files in it.`
              : `"${listed.folderName}": ${listed.files.length} recording${listed.files.length === 1 ? "" : "s"}${fresh.length < listed.files.length ? `, ${listed.files.length - fresh.length} already queued` : ""}.`
          );
        } else if (!fresh.length) {
          notes.push(`${listed.files[0]?.name ?? "That file"} is already in the queue.`);
        }
        if (fresh.length) {
          added += fresh.length;
          // Synchronous, because runQueue() reads the ref in this same tick.
          itemsRef.current = [...itemsRef.current, ...fresh];
          setItems(itemsRef.current);
          void runQueue();
        }
      } catch (e) {
        notes.push(`${url.replace(/^https?:\/\//, "").slice(0, 60)}: ${(e as Error).message}`);
      }
    }
    setAdding(false);
    setLinkText("");
    setIntakeNote(notes.length ? notes.join(" ") : added ? null : "Nothing new to add.");
  }, [linkText, runQueue]);

  const retry = useCallback(
    (id: string) => {
      itemsRef.current = itemsRef.current.map((it) => (it.id === id ? { ...it, status: "queued", error: undefined } : it));
      setItems(itemsRef.current);
      void runQueue();
    },
    [runQueue]
  );

  const done = items.filter((it) => it.status === "done");
  const failedCount = items.filter((it) => it.status === "failed").length;
  const settled = done.length + failedCount;

  // ⚠️ The TAB TITLE carries the progress, because the whole point of a batch is that you walk
  // away from it — and a spinner nobody is looking at tells nobody anything. Restored on the way
  // out so the tab does not keep a stale count after the run.
  useEffect(() => {
    if (!busy || items.length < 2) return;
    const original = document.title;
    document.title = `(${settled}/${items.length}) ${original.replace(/^\(\d+\/\d+\)\s*/, "")}`;
    return () => {
      document.title = original.replace(/^\(\d+\/\d+\)\s*/, "");
    };
  }, [busy, settled, items.length]);


  const textFor = (it: Item) => (view === "raw" ? it.raw : view === "cleaned" ? it.cleaned : it.typing) ?? "";
  const removed = done.reduce((s, it) => s + (it.typingRemoved ?? 0), 0);
  // ⚠️ DROP ORDER, not finish order. With several workers a short file routinely lands before a
  // long one dropped ahead of it, but the transcript is built by filtering `items` — which patch()
  // only ever maps over, so positions never move. The typing skill reads a batch top to bottom
  // against the operator's own file list, so this has to be the order they dropped them in.
  const output = formatBatch(done.map(textFor));
  // [CHECK: …] flags the clean-up appended — a self-correction it couldn't resolve, or a
  // garbled figure number. Counted so the operator searches for them before typing.
  const flags = view === "raw" ? 0 : countFlags(output);
  const anyCleaned = done.some((it) => it.cleanedChanged);
  const cleanupNote = done.find((it) => it.cleanupNote)?.cleanupNote ?? null;

  const copyRow = async (it: Item) => {
    await copy(textFor(it));
    setCopiedId(it.id);
    setTimeout(() => setCopiedId((cur) => (cur === it.id ? null : cur)), 1500);
  };

  return (
    <div>
      {/* Intake: Box links, one or many. A folder link is the whole job. */}
      <form
        className="rounded-xl border border-ad-border bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void addLinks();
        }}
      >
        <label htmlFor="box-links" className="block text-sm font-medium text-ad-ink">
          Paste Box links to the recordings — files or whole folders, one per line
        </label>
        <textarea
          id="box-links"
          value={linkText}
          onChange={(e) => setLinkText(e.target.value)}
          rows={items.length ? 2 : 4}
          placeholder={"https://ausdilaps.app.box.com/folder/…\nhttps://ausdilaps.app.box.com/file/…"}
          className="mt-2 w-full resize-y rounded-lg border border-ad-border bg-white p-3 font-mono text-sm text-ad-ink placeholder:text-ad-muted focus:outline-none focus:ring-2 focus:ring-ad-accent"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="submit" className={cn(buttonVariants({ variant: "primary", size: "md" }))} disabled={adding || !linkText.trim()}>
            {adding ? "Reading Box…" : "Add to queue"}
          </button>
          {!items.length && (
            <span className="text-sm text-ad-muted">
              A folder link queues every recording in it. {BATCH_CONCURRENCY} transcribe at a time; a 15-minute dictation takes about a minute. Nothing is uploaded — Box hands the audio straight to the transcriber.
            </span>
          )}
          {intakeNote && <span className="text-sm text-ad-orange">{intakeNote}</span>}
        </div>
      </form>

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
            {/* Three views of one recording. Segmented rather than a cycling button: the operator
                picks the one they want to copy, and needs to see which one is showing. */}
            <div className="inline-flex overflow-hidden rounded-full border border-ad-border text-sm" role="tablist" aria-label="Transcript view">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  role="tab"
                  aria-selected={view === v.key}
                  disabled={!done.length}
                  onClick={() => setView(v.key)}
                  className={cn(
                    "h-11 px-4 font-medium transition-colors disabled:opacity-50",
                    view === v.key ? "bg-ad-navy text-white" : "text-ad-ink hover:bg-ad-surface"
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
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
            {busy && !stopping && items.some((it) => it.status === "queued") && (
              <button
                type="button"
                className={cn(buttonVariants({ variant: "outline", size: "md" }))}
                onClick={() => {
                  // Workers finish the file in hand and claim no more; runQueue reports the count.
                  stopRequested.current = true;
                  setStopping(true);
                }}
              >
                Stop after these
              </button>
            )}
            {halted && (
              <button
                type="button"
                className={cn(buttonVariants({ variant: "accent", size: "md" }))}
                onClick={() => void runQueue()}
              >
                Resume
              </button>
            )}
            {/* One line for the whole batch. "Working… 143s" on its own does not say how far
                through 27 files it is, which is the only question worth answering here. */}
            {(busy || settled > 0) && (
              <span className="text-sm text-ad-muted">
                {items.length > 1 ? `${settled} of ${items.length} done` : busy ? "Working" : "Done"}
                {failedCount > 0 && <span className="text-ad-orange">{` · ${failedCount} failed`}</span>}
                {busy && ` · ${elapsed}s`}
              </span>
            )}
          </div>

          {halted && <p className="mt-2 text-sm text-ad-orange">{halted}</p>}

          <div className="mt-2">
          </div>

          <p className="mt-2 text-sm text-ad-muted">
            {flags > 0 && (
              <span className="text-ad-orange">
                {flags} line{flags === 1 ? "" : "s"} flagged [CHECK] — a correction the tool couldn&apos;t resolve or a garbled figure number. Search the text for &quot;[CHECK&quot; before typing.{" "}
              </span>
            )}
            {view === "typing"
              ? `For typing: greeting, weather, sign-off and fillers removed${done.length ? ` — ${removed} line${removed === 1 ? "" : "s"} taken out` : ""}. Just the figures. Switch to Cleaned to see everything that was said.`
              : view === "raw"
                ? "Raw: exactly what the transcriber heard."
                : cleanupNote
                  ? cleanupNote
                  : anyCleaned
                    ? "Cleaned: every line, with obvious mis-hearings fixed (yard, tile floors, room numbers). Switch to Raw to check a fix."
                    : done.length
                      ? "Cleaned: every line; nothing needed fixing."
                      : "Cleaned: every line, with obvious mis-hearings fixed."}
          </p>

          {/* The queue */}
          <ul className="mt-4 divide-y divide-ad-border rounded-xl border border-ad-border text-sm">
            {items.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate font-medium text-ad-ink" title={it.name}>
                  {it.name}
                </span>
                <span className="text-ad-muted">{mb(it.size)}</span>
                {it.status === "done" && it.durationSeconds ? (
                  <span className="text-ad-muted">{minutes(it.durationSeconds)}</span>
                ) : null}
                {it.status === "done" && it.costCents !== undefined && (
                  <span className="tabular-nums text-ad-muted" title="API cost of this file at list price: Deepgram plus the clean-up pass">
                    {formatCents(it.costCents)}
                  </span>
                )}
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
                {it.status === "failed" && (
                  <button
                    type="button"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    // Not disabled while busy any more — with several workers there is one free
                    // to pick a retry up, and on a 27-file run waiting for the whole batch to
                    // finish before you can re-queue one file is the wrong trade.
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
