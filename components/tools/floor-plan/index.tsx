"use client";

// Floor Plan tool — sketch photo in, A4 PNG out.
//
// Replaces ~13 minutes of tracing walls by hand in EdrawMax per plan. Claude reads the
// sketch into rooms-on-a-grid; the walls are computed from that, not drawn.
//
// Two views over one plan: Edit is the working canvas, Sheet is the actual A4 output from
// the same renderer the export uses. Photo-range chips share the annotation model the red
// numbers use — only the tray that fills them from Salesforce is still to come.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { downloadBlob } from "@/components/tools/shared/download";
import {
  buildOwnerGrid,
  doorWalls,
  outdoorIds,
  validateLevel,
  wallNeighbours,
} from "@/lib/floor-plan/grid";
import {
  addDoor,
  deleteDoor,
  deleteLine,
  deleteMark,
  deleteRoom,
  deleteStair,
  doorCandidates,
  removeWall,
  renameRoom,
  restoreWall,
  splitRoom,
  updateDoor,
  updateLine,
  updateMark,
  updateStair,
  type EditResult,
} from "@/lib/floor-plan/edit";
import { renderPlan } from "@/lib/floor-plan/render";
import { a4Pixels, floorPlanSchema, OUTSIDE, type FloorPlan, type Level } from "@/lib/floor-plan/types";
import { FloorPlanEditor, type Selection, type Tool } from "./editor";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_UNDO = 40;

/** A4 at 300 DPI = 2480x3508, the size the report expects. */
const EXPORT_DPI = 300;

function slugify(value: string): string {
  return (
    value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) ||
    "floor-plan"
  );
}

function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

/**
 * Vercel rejects any serverless request body over 4.5MB, before the route runs. A phone photo
 * of a sketch is ~6MB, which is ~8MB once base64-encoded, so every upload was being bounced by
 * the platform with a plain-text 413 that never reached this code.
 *
 * Budget the encoded payload, not the file: base64 inflates by 4/3.
 */
const MAX_UPLOAD_BASE64 = 3.5 * 1024 * 1024;
const rawToBase64Bytes = (bytes: number) => Math.ceil((bytes * 4) / 3);

/** Long edge below which the compass stops being legible — measured, not guessed. */
const MIN_LONG_EDGE = 2400;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be opened."));
    };
    img.src = url;
  });
}

function encode(img: HTMLImageElement, scale: number, quality: number): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Shrink an oversized photo to fit the upload budget.
 *
 * Quality first, pixels last. Compass legibility depends on RESOLUTION, not file size — at full
 * 3000x4000 and quality 0.6 a 6.2MB photo becomes 1.8MB and still reads north correctly, where
 * halving the long edge to 1568px broke it. Only when re-encoding alone is not enough does the
 * long edge come down, and never below MIN_LONG_EDGE.
 */
async function fitForUpload(file: File): Promise<Blob> {
  if (rawToBase64Bytes(file.size) <= MAX_UPLOAD_BASE64) return file;

  const img = await loadImage(file);
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);

  for (const { scale, quality } of [
    { scale: 1, quality: 0.6 },
    { scale: 1, quality: 0.45 },
    { scale: Math.min(1, MIN_LONG_EDGE / longEdge), quality: 0.6 },
  ]) {
    const blob = await encode(img, scale, quality);
    if (blob && rawToBase64Bytes(blob.size) <= MAX_UPLOAD_BASE64) return blob;
  }

  throw new Error("That photo is too large to upload. Crop it to just the drawing and retry.");
}

const COMPASS = [
  { deg: 0, label: "Up" },
  { deg: 90, label: "Right" },
  { deg: 180, label: "Down" },
  { deg: 270, label: "Left" },
] as const;

function Panel({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  // `open` has to be held in state rather than left to the DOM: React treats it as a
  // controlled attribute, so any re-render of the tool (hovering a wall row is enough) would
  // otherwise snap every panel back to its initial state mid-use.
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group rounded-xl border border-ad-border bg-white p-5"
    >
      <summary className="flex cursor-pointer list-none items-baseline justify-between">
        <h3 className="text-sm font-semibold text-ad-ink">
          <span className="mr-1.5 inline-block text-ad-muted transition-transform group-open:rotate-90">
            ▸
          </span>
          {title}
        </h3>
        <span className="text-xs text-ad-muted">{count}</span>
      </summary>
      {children}
    </details>
  );
}

export function FloorPlanTool() {
  const [plan, setPlan] = useState<FloorPlan | null>(null);
  const [history, setHistory] = useState<FloorPlan[]>([]);
  const [view, setView] = useState<"edit" | "sheet">("edit");
  const [tool, setTool] = useState<Tool>("select");
  const [levelIndex, setLevelIndex] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [sketchUrl, setSketchUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"extract" | "export" | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  /** What the Number tool places next. Steps on after each placement so numbering a set of
   *  photos is click, click, click rather than retype, click, retype, click. */
  const [markText, setMarkText] = useState("1");
  const [hoverWall, setHoverWall] = useState<{ a: string; b: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  const level = plan?.levels[levelIndex];

  const svg = useMemo(
    () => (plan && view === "sheet" ? renderPlan(plan, { mode: "preview", dpi: 150, levelIndex }) : null),
    [plan, view, levelIndex]
  );

  const issues = useMemo(() => {
    if (!plan) return [];
    return plan.levels.flatMap((lvl) =>
      validateLevel(lvl, plan.grid).map((i) => ({ ...i, level: lvl.name }))
    );
  }, [plan]);

  const walls = useMemo(() => {
    if (!plan || !level) return [];
    const owner = buildOwnerGrid(level.rooms, plan.grid);
    const pairs = wallNeighbours(owner, plan.grid, outdoorIds(level.rooms));
    const rank = { internal: 0, external: 1, area: 2 } as const;
    const rows = pairs
      .map((pair) => ({
        ...pair,
        removed: level.removedWalls.find(
          (w) => (w.a === pair.a && w.b === pair.b) || (w.a === pair.b && w.b === pair.a)
        ),
        orphan: false,
      }))
      .sort((p, q) => rank[p.kind] - rank[q.kind] || q.cells - p.cells);

    // A suppression whose two rooms have since been dragged apart draws nothing and would
    // otherwise vanish from the UI with no way to restore it. List it, flagged.
    const listed = new Set(rows.filter((r) => r.removed).map((r) => r.removed!.id));
    for (const w of level.removedWalls) {
      if (listed.has(w.id)) continue;
      rows.push({ key: w.id, a: w.a, b: w.b, kind: "internal", cells: 0, removed: w, orphan: true });
    }
    return rows;
  }, [plan, level]);

  const marks = useMemo(
    () => level?.annotations.filter((a) => a.kind === "mark") ?? [],
    [level]
  );

  const inferredDoors = useMemo(
    () =>
      plan
        ? plan.levels.reduce((n, l) => n + l.doors.filter((d) => d.confidence === "inferred").length, 0)
        : 0,
    [plan]
  );

  /**
   * Undo bookkeeping.
   *
   * Every setter here is called at the top level, never from inside another setter's updater
   * function. An updater must be pure — React runs it twice in development precisely to catch
   * this — and nesting setHistory inside setPlan pushed two entries per edit, so undo needed
   * pressing twice for one change.
   *
   * `coalesce` collapses a run of related edits into one entry. Typing a room name fires an
   * edit per keystroke; without it, renaming "Bed 2" to "Bedroom 2" costs eight undos.
   */
  const lastCoalesceKey = useRef<string | null>(null);

  const pushHistory = useCallback((snapshot: FloorPlan, coalesce?: string) => {
    const repeat = coalesce !== undefined && coalesce === lastCoalesceKey.current;
    lastCoalesceKey.current = coalesce ?? null;
    if (repeat) return;
    setHistory((h) => [...h.slice(-MAX_UNDO), snapshot]);
  }, []);

  const commit = useCallback(
    (next: FloorPlan, coalesce?: string) => {
      if (plan) pushHistory(plan, coalesce);
      setPlan(next);
    },
    [plan, pushHistory]
  );

  const undo = useCallback(() => {
    if (history.length === 0) return;
    lastCoalesceKey.current = null;
    setPlan(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
    setSelection(null);
  }, [history]);

  function update(patch: Partial<FloorPlan>, coalesce?: string) {
    if (!plan) return;
    commit({ ...plan, ...patch }, coalesce);
  }

  const setLevel = useCallback(
    (next: Level, coalesce?: string) => {
      if (!plan) return;
      pushHistory(plan, coalesce);
      const levels = [...plan.levels];
      levels[levelIndex] = next;
      setPlan({ ...plan, levels });
    },
    [plan, levelIndex, pushHistory]
  );

  /** Editing helpers return either a new level or a reason they refused. */
  function apply(result: EditResult, coalesce?: string) {
    if (result.ok) {
      setError(null);
      setLevel(result.level, coalesce);
    } else {
      setError(result.error);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // Don't hijack undo while someone is typing a room name.
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
      if (e.key === "Escape") setSelection(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  async function handleSketch(file: File) {
    if (!ACCEPTED.includes(file.type)) {
      setError("That file is not an image. Use a JPG or PNG photo of the sketch.");
      return;
    }
    setError(null);
    setBusy("extract");
    setElapsed(0);
    // Reading a whole layout takes the better part of a minute — an unexplained frozen
    // button for that long reads as a hang, so count it out loud.
    const started = Date.now();
    const ticker = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);

    try {
      // Always show the original, whatever gets uploaded — this is what north is checked against.
      setSketchUrl(URL.createObjectURL(file));
      const upload = await fitForUpload(file);
      const image = await readAsBase64(upload);

      // Send the type of what we are ACTUALLY sending. This used to be hardcoded to
      // image/jpeg, which was true only by accident: fitForUpload re-encodes as JPEG, but it
      // returns the original file untouched when that is already small enough. So a PNG under
      // the budget went up as PNG bytes labelled JPEG, and the API rejected it outright —
      // "the image appears to be a image/png image". Every PNG, WebP and GIF small enough to
      // skip re-encoding failed this way, which includes every screenshot and every
      // web-resolution plan; a big phone photo worked only because re-encoding made the lie
      // true. The route has always accepted all four types.
      const res = await fetch("/api/floor-plan/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image, mediaType: upload.type || file.type }),
      });

      // A non-JSON body means something upstream rejected this before the route ran — Vercel
      // returns plain text for an oversized payload or a function timeout. Collapsing that into
      // the generic message is what disguised a 413 as a reading failure for an entire round of
      // debugging, so name the status instead of swallowing it.
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; plan?: FloorPlan; error?: string }
        | null;
      if (!json) {
        if (res.status === 413) {
          throw new Error("That photo was too large to upload. Crop it to just the drawing and retry.");
        }
        if (res.status === 504) {
          throw new Error("Reading the sketch took too long and the server gave up. Try a tighter crop.");
        }
        throw new Error(`The server returned an unexpected response (HTTP ${res.status}).`);
      }
      if (!json.ok || !json.plan) throw new Error(json.error ?? "Could not read that sketch.");

      setPlan(json.plan);
      setHistory([]);
      setLevelIndex(0);
      setSelection(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that sketch.");
    } finally {
      clearInterval(ticker);
      setBusy(null);
    }
  }

  async function handlePlanJson(file: File) {
    setError(null);
    try {
      const parsed = floorPlanSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error("That .json is not a floor plan file.");
      // Older saved plans may carry orientation "landscape" from before the sheet was fixed.
      setPlan({ ...parsed.data, orientation: "portrait" });
      setHistory([]);
      setLevelIndex(0);
      setSelection(null);
      setSketchUrl(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    }
  }

  /**
   * Rasterise the A4 sheet in the browser.
   *
   * This used to POST the plan to a route that rendered it with sharp. That route silently
   * dropped every piece of text — room names, level caption, address, the compass "N" — because
   * the SVG asks for Arial/Helvetica and Vercel's Linux container ships no fonts at all. Walls
   * are paths so they survived; text did not. It looked fine locally, where macOS has the fonts,
   * which is exactly what hid it.
   *
   * Rendering here fixes that permanently: the browser has fonts, the on-screen preview and the
   * download become the same rasteriser rather than two that can disagree, and a ~2.4MB round
   * trip disappears.
   */
  const renderPng = useCallback(async (target: FloorPlan, index: number): Promise<Blob> => {
    const page = a4Pixels(EXPORT_DPI, target.orientation);
    const svg = renderPlan(target, { mode: "export", dpi: EXPORT_DPI, levelIndex: index });

    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Could not render the plan."));
        el.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = page.w;
      canvas.height = page.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not render the plan.");
      // The SVG has no background of its own beyond its own white rect; paint anyway so a
      // transparent PNG can never reach a report.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, page.w, page.h);
      ctx.drawImage(img, 0, 0, page.w, page.h);

      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("Could not render the plan.");
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }, []);

  /**
   * One PNG per level, named for it.
   *
   * Every level is its own page now, so a two-storey plan downloads two files. Sequential
   * rather than zipped: the reports team drops these straight into a document, and three files
   * already in Downloads beats one they have to unpack. (fflate is a dependency if that ever
   * changes.)
   */
  async function exportPng() {
    if (!plan) return;
    setError(null);
    setBusy("export");
    try {
      const stem = slugify(plan.address || "floor-plan");
      for (const [i, lvl] of plan.levels.entries()) {
        const blob = await renderPng(plan, i);
        const name = plan.levels.length > 1 ? `${stem}-${slugify(lvl.name || `level-${i + 1}`)}` : stem;
        downloadBlob(blob, `${name}-floor-plan.png`, "image/png");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not render the plan.");
    } finally {
      setBusy(null);
    }
  }

  const selectedRoom =
    level && selection?.type === "room" ? level.rooms.find((r) => r.id === selection.id) : undefined;
  const selectedDoor =
    level && selection?.type === "door" ? level.doors.find((d) => d.id === selection.id) : undefined;

  /** Every wall the selected door could hang on — more than one where its rooms meet in an L. */
  const selectedDoorWalls = useMemo(() => {
    if (!plan || !level || !selectedDoor) return [];
    return doorWalls(buildOwnerGrid(level.rooms, plan.grid), plan.grid, selectedDoor.a, selectedDoor.b);
  }, [plan, level, selectedDoor]);

  const selectedDoorWallIndex = selectedDoor?.wall
    ? Math.max(
        0,
        selectedDoorWalls.findIndex(
          (w) => w.orient === selectedDoor.wall!.orient && w.pos === selectedDoor.wall!.pos
        )
      )
    : 0;

  const roomLabel = (id: string) =>
    id === OUTSIDE ? "Outside" : level?.rooms.find((r) => r.id === id)?.label || "Unnamed";

  return (
    <div>
      {!plan && (
        <>
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
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
              const f = e.dataTransfer.files?.[0];
              if (f) void handleSketch(f);
            }}
            className={cn(
              "mt-6 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
              dragActive ? "border-ad-orange bg-ad-orange/10" : "border-ad-border hover:bg-ad-surface"
            )}
          >
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED.join(",")}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleSketch(f);
                e.target.value = "";
              }}
            />
            <p className="font-medium text-ad-ink">
              {dragActive ? "Drop the sketch here" : "Drag & drop a photo of the sketch, or click to browse"}
            </p>
            <p className="max-w-md text-sm text-ad-muted">
              A phone photo of the inspector&apos;s hand drawing. Rooms, labels and the compass are read
              off it; nothing is measured, so the plan is schematic.
            </p>
          </div>

          <div className="mt-4 text-center">
            <input
              ref={jsonInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handlePlanJson(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => jsonInput.current?.click()}
              className="text-sm text-ad-muted underline hover:text-ad-ink"
            >
              or reopen a saved .json plan
            </button>
          </div>
        </>
      )}

      {busy === "extract" && (
        <div className="mt-4 rounded-xl border border-ad-border bg-ad-surface p-4 text-sm text-ad-ink">
          Reading the sketch… {elapsed}s
          <span className="block text-ad-muted">This takes about a minute. Leave the tab open.</span>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-ad-orange bg-ad-orange/10 p-4 text-sm text-ad-ink">
          {error}
        </div>
      )}

      {plan && level && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <div className="flex gap-1 rounded-lg border border-ad-border p-1">
                {(["edit", "sheet"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className={cn(
                      "rounded px-3 py-1 text-xs font-medium capitalize",
                      view === v ? "bg-ad-steel/10 text-ad-ink" : "text-ad-muted hover:text-ad-ink"
                    )}
                  >
                    {v === "sheet" ? "A4 sheet" : "Edit"}
                  </button>
                ))}
              </div>
              {view === "edit" && (
                <div className="flex gap-1 rounded-lg border border-ad-border p-1">
                  {(
                    [
                      { key: "select", label: "Select" },
                      { key: "fence", label: "Fence" },
                      { key: "number", label: "Number" },
                      { key: "stairs", label: "Stairs" },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => {
                        setTool(t.key);
                        setSelection(null);
                      }}
                      className={cn(
                        "rounded px-3 py-1 text-xs font-medium",
                        tool === t.key ? "bg-ad-steel/10 text-ad-ink" : "text-ad-muted hover:text-ad-ink"
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
              {view === "edit" && tool === "number" && (
                <input
                  value={markText}
                  onChange={(e) => setMarkText(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  inputMode="numeric"
                  aria-label="Number to place"
                  className="w-14 rounded-lg border border-ad-border px-2 py-1.5 text-center text-xs font-semibold text-ad-ink outline-none focus:border-ad-steel"
                />
              )}
              <button
                type="button"
                onClick={undo}
                disabled={history.length === 0}
                className="rounded-lg border border-ad-border px-3 py-1.5 text-xs font-medium text-ad-muted hover:text-ad-ink disabled:opacity-40"
              >
                Undo
              </button>
              {plan.levels.length > 1 && (
                <div className="flex gap-1 rounded-lg border border-ad-border p-1">
                  {plan.levels.map((l, i) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => {
                        setLevelIndex(i);
                        setSelection(null);
                      }}
                      className={cn(
                        "rounded px-2 py-1 text-xs font-medium",
                        levelIndex === i ? "bg-ad-steel/10 text-ad-ink" : "text-ad-muted hover:text-ad-ink"
                      )}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-ad-border bg-white p-4">
              {view === "edit" ? (
                <FloorPlanEditor
                  plan={plan}
                  levelIndex={levelIndex}
                  tool={tool}
                  selection={selection}
                  highlightWall={hoverWall}
                  markText={markText}
                  onSelect={setSelection}
                  onChange={setLevel}
                  onError={setError}
                  onMarkPlaced={() =>
                    setMarkText((n) => String(Math.min(999, (Number(n) || 0) + 1)))
                  }
                />
              ) : (
                <div
                  className="mx-auto max-w-lg [&>svg]:h-auto [&>svg]:w-full"
                  // Same renderer the export uses, so this is the sheet, not an impression of it.
                  dangerouslySetInnerHTML={{ __html: svg ?? "" }}
                />
              )}
            </div>

            {view === "edit" && (
              <p className="mt-2 text-xs text-ad-muted">
                {tool === "select" ? (
                  <>
                    Click a room to select it. Drag it to move, drag a handle to resize — growing a
                    room takes space from its neighbour, so a handle on a shared wall moves that
                    wall. Drag a door, a number or a staircase to reposition it. ⌘Z undoes.
                  </>
                ) : tool === "fence" ? (
                  "Drag along a grid line to draw a fence."
                ) : tool === "number" ? (
                  "Click anywhere to drop the number. It steps on by one each time."
                ) : (
                  "Drag out a rectangle where the stairs go."
                )}
              </p>
            )}
          </div>

          <div className="space-y-5">
            {selectedRoom && (
              <div className="rounded-xl border border-ad-steel bg-ad-steel/5 p-5">
                <h3 className="text-sm font-semibold text-ad-ink">Room</h3>
                <input
                  value={selectedRoom.label}
                  onChange={(e) =>
                    apply(renameRoom(level, selectedRoom.id, e.target.value), `rename:${selectedRoom.id}`)
                  }
                  className="mt-2 w-full rounded-lg border border-ad-border p-2 text-sm outline-none focus:border-ad-steel"
                />
                <p className="mt-3 text-xs font-medium text-ad-ink">Add a door to…</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {doorCandidates(level, selectedRoom.id)
                    .filter(
                      (c) =>
                        !level.doors.some(
                          (d) =>
                            (d.a === selectedRoom.id && d.b === c.id) ||
                            (d.b === selectedRoom.id && d.a === c.id)
                        )
                    )
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => apply(addDoor(level, selectedRoom.id, c.id))}
                        className="rounded border border-ad-border bg-white px-2 py-1 text-xs text-ad-ink hover:border-ad-steel"
                      >
                        + {c.label}
                      </button>
                    ))}
                </div>
                {/* Splitting is how a wall gets ADDED: walls exist where two rooms meet, so
                    handing half the cells to a new room makes one appear. Position it after
                    with the edge handles. */}
                <p className="mt-4 text-xs font-medium text-ad-ink">Add a wall by splitting</p>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => apply(splitRoom(level, plan.grid, selectedRoom.id, "v"))}
                    className="rounded-lg border border-ad-border bg-white px-2 py-1.5 text-xs font-medium text-ad-ink hover:border-ad-steel"
                  >
                    Split ｜ left/right
                  </button>
                  <button
                    type="button"
                    onClick={() => apply(splitRoom(level, plan.grid, selectedRoom.id, "h"))}
                    className="rounded-lg border border-ad-border bg-white px-2 py-1.5 text-xs font-medium text-ad-ink hover:border-ad-steel"
                  >
                    Split — top/bottom
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    apply(deleteRoom(level, selectedRoom.id));
                    setSelection(null);
                  }}
                  className="mt-4 w-full rounded-lg border border-ad-orange px-2 py-1.5 text-xs font-medium text-ad-ink hover:bg-ad-orange/10"
                >
                  Delete room
                </button>
              </div>
            )}

            {selectedDoor && (
              <div className="rounded-xl border border-ad-steel bg-ad-steel/5 p-5">
                <h3 className="text-sm font-semibold text-ad-ink">Door</h3>
                <p className="mt-1 text-xs text-ad-muted">
                  {roomLabel(selectedDoor.a)} → {roomLabel(selectedDoor.b)}
                </p>
                {/* "opening" is already modelled and already renders as a gap with no arc —
                    subtractOpenings cuts the wall either way. This is the missing button. */}
                <div className="mt-3 flex gap-1 rounded-lg border border-ad-border p-1">
                  {(
                    [
                      { key: "swing", label: "Swing" },
                      { key: "double", label: "Double" },
                      { key: "sliding", label: "Sliding" },
                      { key: "opening", label: "Open" },
                    ] as const
                  ).map((k) => (
                    <button
                      key={k.key}
                      type="button"
                      onClick={() => apply(updateDoor(level, selectedDoor.id, { kind: k.key }))}
                      className={cn(
                        "flex-1 rounded px-1.5 py-1 text-xs font-medium",
                        selectedDoor.kind === k.key
                          ? "bg-ad-steel/10 text-ad-ink"
                          : "text-ad-muted hover:text-ad-ink"
                      )}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={selectedDoor.kind === "opening" || selectedDoor.kind === "sliding"}
                    onClick={() =>
                      apply(
                        updateDoor(level, selectedDoor.id, {
                          swingInto: selectedDoor.swingInto === "a" ? "b" : "a",
                        })
                      )
                    }
                    className="rounded-lg border border-ad-border bg-white px-2 py-1.5 text-xs font-medium text-ad-ink hover:border-ad-steel"
                  >
                    Flip side
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      apply(
                        updateDoor(level, selectedDoor.id, {
                          hinge: selectedDoor.hinge === "start" ? "end" : "start",
                        })
                      )
                    }
                    className="rounded-lg border border-ad-border bg-white px-2 py-1.5 text-xs font-medium text-ad-ink hover:border-ad-steel"
                  >
                    Flip hinge
                  </button>
                </div>
                {selectedDoorWalls.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const at = selectedDoorWalls.findIndex(
                        (w) =>
                          selectedDoor.wall &&
                          w.orient === selectedDoor.wall.orient &&
                          w.pos === selectedDoor.wall.pos
                      );
                      const next = selectedDoorWalls[(at + 1) % selectedDoorWalls.length];
                      // Clear `at` too: an offset measured along the old wall means nothing
                      // on the new one, and keeping it would land the door somewhere arbitrary.
                      apply(updateDoor(level, selectedDoor.id, { wall: next, at: undefined }));
                    }}
                    className="mt-2 w-full rounded-lg border border-ad-border bg-white px-2 py-1.5 text-xs font-medium text-ad-ink hover:border-ad-steel"
                  >
                    Next wall — {selectedDoorWallIndex + 1} of {selectedDoorWalls.length}
                  </button>
                )}
                {selectedDoor.at !== undefined && (
                  <button
                    type="button"
                    onClick={() => apply(updateDoor(level, selectedDoor.id, { at: undefined }))}
                    className="mt-2 w-full rounded-lg border border-ad-border bg-white px-2 py-1.5 text-xs font-medium text-ad-muted hover:text-ad-ink"
                  >
                    Re-centre on wall
                  </button>
                )}
                {selectedDoor.confidence === "inferred" && (
                  <button
                    type="button"
                    onClick={() => apply(updateDoor(level, selectedDoor.id, { confidence: "visible" }))}
                    className="mt-2 w-full rounded-lg border border-ad-border bg-white px-2 py-1.5 text-xs font-medium text-ad-ink hover:border-ad-steel"
                  >
                    Confirm — it&apos;s really there
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    apply(deleteDoor(level, selectedDoor.id));
                    setSelection(null);
                  }}
                  className="mt-2 w-full rounded-lg border border-ad-orange px-2 py-1.5 text-xs font-medium text-ad-ink hover:bg-ad-orange/10"
                >
                  Delete door
                </button>
              </div>
            )}

            {/*
              Every room, listed, with the name editable right here. Renaming has always been
              possible by selecting a room on the canvas, but nobody found it — the same failure
              the Doors list below was added to fix. A list beats a hidden field.
            */}
            <Panel title="Rooms" count={level.rooms.length} defaultOpen>
              <ul className="mt-2 space-y-1">
                {level.rooms.map((room) => {
                  const isSelected = selection?.type === "room" && selection.id === room.id;
                  return (
                    <li key={room.id} className="flex items-center gap-1">
                      <input
                        value={room.label}
                        onFocus={() => setSelection({ type: "room", id: room.id })}
                        onChange={(e) =>
                          apply(renameRoom(level, room.id, e.target.value), `rename:${room.id}`)
                        }
                        className={cn(
                          "min-w-0 flex-1 rounded border px-2 py-1 text-xs outline-none",
                          isSelected
                            ? "border-ad-steel bg-ad-steel/5 text-ad-ink"
                            : "border-transparent text-ad-muted hover:border-ad-border hover:text-ad-ink focus:border-ad-steel"
                        )}
                      />
                      {room.kind === "outdoor" && (
                        <span className="shrink-0 text-[0.65rem] uppercase tracking-wide text-ad-muted">
                          outdoor
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={`Delete ${room.label || "room"}`}
                        onClick={() => {
                          apply(deleteRoom(level, room.id));
                          if (isSelected) setSelection(null);
                        }}
                        className="shrink-0 rounded px-2 py-1 text-xs text-ad-muted hover:bg-ad-orange/10 hover:text-ad-ink"
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-ad-muted">
                Type to rename. Click a room on the plan to move, resize or split it.
              </p>
            </Panel>

            {/*
              Walls are derived from cell ownership, so there is nothing to click on the canvas
              that isn't already a room's resize handle — the two would fight for the same
              pixels. Hence a list, hovered to show you which one you mean. Removing leaves both
              rooms named and changes nothing structural, so Restore is just a filter.
            */}
            <Panel title="Walls" count={walls.filter((w) => !w.removed).length}>
              <ul className="mt-2 space-y-1">
                {walls.map((w) => (
                  <li key={w.key} className="flex items-center gap-1">
                    <button
                      type="button"
                      onMouseEnter={() => setHoverWall({ a: w.a, b: w.b })}
                      onMouseLeave={() => setHoverWall(null)}
                      onFocus={() => setHoverWall({ a: w.a, b: w.b })}
                      onBlur={() => setHoverWall(null)}
                      className={cn(
                        "flex-1 truncate rounded px-2 py-1 text-left text-xs",
                        w.removed
                          ? "text-ad-muted line-through"
                          : "text-ad-muted hover:bg-ad-surface hover:text-ad-ink"
                      )}
                    >
                      {roomLabel(w.a)} · {roomLabel(w.b)}
                      {w.orphan && (
                        <span className="ml-1 no-underline text-ad-orange">not touching</span>
                      )}
                    </button>
                    {w.removed ? (
                      <button
                        type="button"
                        onClick={() => apply(restoreWall(level, w.removed!.id))}
                        className="shrink-0 rounded px-2 py-1 text-xs text-ad-steel hover:bg-ad-surface"
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Remove the wall between ${roomLabel(w.a)} and ${roomLabel(w.b)}`}
                        onClick={() => apply(removeWall(level, w.a, w.b))}
                        className="shrink-0 rounded px-2 py-1 text-xs text-ad-muted hover:bg-ad-orange/10 hover:text-ad-ink"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ad-muted">
                Removing a wall leaves both rooms named — open plan. Nothing else moves, so
                Restore always puts it back.
              </p>
            </Panel>

            <Panel title="Lines" count={level.lines.length}>
              {level.lines.length === 0 ? (
                <p className="mt-2 text-xs text-ad-muted">
                  None. Switch the canvas to <span className="font-medium text-ad-ink">Fence</span>,
                  then drag along a grid line to draw one.
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {level.lines.map((line, i) => {
                    const isSelected = selection?.type === "line" && selection.id === line.id;
                    const hasGate = line.gate !== undefined;
                    return (
                      <li key={line.id} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setSelection({ type: "line", id: line.id })}
                          className={cn(
                            "flex-1 truncate rounded px-2 py-1 text-left text-xs capitalize",
                            isSelected
                              ? "bg-ad-steel/10 font-medium text-ad-ink"
                              : "text-ad-muted hover:bg-ad-surface hover:text-ad-ink"
                          )}
                        >
                          {line.kind} {i + 1} · {line.orient === "v" ? "vertical" : "horizontal"} ·{" "}
                          {Math.round(line.to - line.from)} cells
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            apply(
                              updateLine(level, line.id, {
                                // Centre the gate on the run; drag it later if it wants moving.
                                gate: hasGate ? undefined : Math.round((line.from + line.to) / 2 - 0.5),
                              })
                            )
                          }
                          className={cn(
                            "shrink-0 rounded px-2 py-1 text-xs",
                            hasGate
                              ? "bg-ad-steel/10 font-medium text-ad-ink"
                              : "text-ad-muted hover:bg-ad-surface hover:text-ad-ink"
                          )}
                        >
                          Gate
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${line.kind} ${i + 1}`}
                          onClick={() => {
                            apply(deleteLine(level, line.id));
                            if (isSelected) setSelection(null);
                          }}
                          className="shrink-0 rounded px-2 py-1 text-xs text-ad-muted hover:bg-ad-orange/10 hover:text-ad-ink"
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            {/*
              Every door, listed. Selecting one on the canvas means hitting a doorway-sized
              target, which is a sliver on screen at any sensible zoom — so removing a door
              cannot be a canvas-only gesture. This also puts the inferred ones somewhere you
              can review them as a set rather than hunting for dashes in the drawing.
            */}
            <Panel title="Doors" count={level.doors.length}>
              {level.doors.length === 0 ? (
                <p className="mt-2 text-xs text-ad-muted">
                  None. Select a room to add one between it and a neighbour.
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {level.doors.map((door) => {
                    const isSelected = selection?.type === "door" && selection.id === door.id;
                    return (
                      <li key={door.id} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setSelection({ type: "door", id: door.id })}
                          className={cn(
                            "flex-1 truncate rounded px-2 py-1 text-left text-xs",
                            isSelected
                              ? "bg-ad-steel/10 font-medium text-ad-ink"
                              : "text-ad-muted hover:bg-ad-surface hover:text-ad-ink"
                          )}
                        >
                          {roomLabel(door.a)} → {roomLabel(door.b)}
                          {door.confidence === "inferred" && (
                            <span className="ml-1 text-ad-orange">•</span>
                          )}
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete door between ${roomLabel(door.a)} and ${roomLabel(door.b)}`}
                          onClick={() => {
                            apply(deleteDoor(level, door.id));
                            if (isSelected) setSelection(null);
                          }}
                          className="rounded px-2 py-1 text-xs text-ad-muted hover:bg-ad-orange/10 hover:text-ad-ink"
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {inferredDoors > 0 && (
                <p className="mt-2 text-xs text-ad-muted">
                  <span className="text-ad-orange">•</span> not drawn on the sketch — check or
                  delete these.
                </p>
              )}
            </Panel>

            <Panel title="Numbers" count={marks.length}>
              {marks.length === 0 ? (
                <p className="mt-2 text-xs text-ad-muted">
                  None. Switch the canvas to <span className="font-medium text-ad-ink">Number</span>,
                  then click where each one goes.
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {marks.map((mark) => {
                    const isSelected = selection?.type === "mark" && selection.id === mark.id;
                    return (
                      <li key={mark.id} className="flex items-center gap-1">
                        <input
                          value={mark.text}
                          inputMode="numeric"
                          aria-label="Number"
                          onFocus={() => setSelection({ type: "mark", id: mark.id })}
                          onChange={(e) =>
                            apply(
                              updateMark(level, mark.id, {
                                text: e.target.value.replace(/\D/g, "").slice(0, 3),
                              }),
                              `mark:${mark.id}`
                            )
                          }
                          className={cn(
                            "w-16 rounded border px-2 py-1 text-center text-xs font-semibold outline-none",
                            isSelected
                              ? "border-ad-steel bg-ad-steel/5"
                              : "border-transparent hover:border-ad-border focus:border-ad-steel"
                          )}
                          style={{ color: "#d92b2b" }}
                        />
                        <span className="flex-1 truncate text-xs text-ad-muted">
                          {mark.anchor.type === "free"
                            ? `${Math.round(mark.anchor.x)}, ${Math.round(mark.anchor.y)}`
                            : ""}
                        </span>
                        <button
                          type="button"
                          aria-label={`Delete number ${mark.text}`}
                          onClick={() => {
                            apply(deleteMark(level, mark.id));
                            if (isSelected) setSelection(null);
                          }}
                          className="shrink-0 rounded px-2 py-1 text-xs text-ad-muted hover:bg-ad-orange/10 hover:text-ad-ink"
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel title="Stairs" count={level.stairs.length}>
              {level.stairs.length === 0 ? (
                <p className="mt-2 text-xs text-ad-muted">
                  None. Switch the canvas to <span className="font-medium text-ad-ink">Stairs</span>,
                  then drag out a rectangle where they go.
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {level.stairs.map((stair, i) => {
                    const isSelected = selection?.type === "stair" && selection.id === stair.id;
                    return (
                      <li key={stair.id} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setSelection({ type: "stair", id: stair.id })}
                          className={cn(
                            "flex-1 truncate rounded px-2 py-1 text-left text-xs",
                            isSelected
                              ? "bg-ad-steel/10 font-medium text-ad-ink"
                              : "text-ad-muted hover:bg-ad-surface hover:text-ad-ink"
                          )}
                        >
                          Stairs {i + 1} · {stair.w}×{stair.h} · {stair.dir === "up" ? "up" : "down"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            apply(
                              updateStair(level, stair.id, {
                                dir: stair.dir === "up" ? "down" : "up",
                              })
                            )
                          }
                          className="shrink-0 rounded px-2 py-1 text-xs text-ad-muted hover:bg-ad-surface hover:text-ad-ink"
                        >
                          Flip
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete staircase ${i + 1}`}
                          onClick={() => {
                            apply(deleteStair(level, stair.id));
                            if (isSelected) setSelection(null);
                          }}
                          className="shrink-0 rounded px-2 py-1 text-xs text-ad-muted hover:bg-ad-orange/10 hover:text-ad-ink"
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <div className="rounded-xl border border-ad-border bg-white p-5">
              <h3 className="text-sm font-semibold text-ad-ink">Title block</h3>
              <label className="mt-3 block text-sm font-medium text-ad-ink">
                Address
                <input
                  value={plan.address}
                  onChange={(e) => update({ address: e.target.value }, "address")}
                  className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm outline-none focus:border-ad-steel"
                />
              </label>
              <label className="mt-3 block text-sm font-medium text-ad-ink">
                Suburb
                <input
                  value={plan.suburb}
                  placeholder="Not on the sketch — type it"
                  onChange={(e) => update({ suburb: e.target.value }, "suburb")}
                  className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm outline-none focus:border-ad-steel"
                />
              </label>
              <label className="mt-3 block text-sm font-medium text-ad-ink">
                Level name
                <input
                  value={level.name}
                  onChange={(e) => setLevel({ ...level, name: e.target.value }, `level:${level.id}`)}
                  className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm outline-none focus:border-ad-steel"
                />
              </label>
            </div>

            {/* North is the likeliest silent error: the reference sketch's compass has N
                pointing DOWN the page. Show the model's reading so it can be checked. */}
            <div className="rounded-xl border border-ad-border bg-white p-5">
              <h3 className="text-sm font-semibold text-ad-ink">North — check this</h3>
              <div className="mt-3 flex gap-2">
                {COMPASS.map((c) => (
                  <button
                    key={c.deg}
                    type="button"
                    onClick={() => update({ north: c.deg })}
                    className={cn(
                      "flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium",
                      plan.north === c.deg
                        ? "border-ad-steel bg-ad-steel/10 text-ad-ink"
                        : "border-ad-border text-ad-muted hover:text-ad-ink"
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              {plan.northNote && (
                <p className="mt-3 text-xs leading-relaxed text-ad-muted">{plan.northNote}</p>
              )}
              {sketchUrl && (
                <>
                  {/* The sketch sits in this panel rather than lower down on purpose: north is
                      the one field worth checking against the original every time, and it is
                      measurably least reliable when the page was photographed sideways. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={sketchUrl}
                    alt="The sketch this plan was read from"
                    className="mt-3 w-full rounded-lg border border-ad-border"
                  />
                  <p className="mt-2 text-xs text-ad-muted">
                    Compare against the compass on the sketch. Reading it is least reliable when
                    the page was photographed sideways or upside down.
                  </p>
                </>
              )}
            </div>

            {(issues.length > 0 || inferredDoors > 0) && (
              <div className="rounded-xl border border-ad-orange bg-ad-orange/10 p-5">
                <h3 className="text-sm font-semibold text-ad-ink">Worth checking</h3>
                <ul className="mt-2 space-y-1 text-xs text-ad-ink">
                  {inferredDoors > 0 && (
                    <li>
                      {inferredDoors} door{inferredDoors === 1 ? " was" : "s were"} not drawn on the
                      sketch — shown dashed.
                    </li>
                  )}
                  {issues.map((issue, i) => (
                    <li key={i}>
                      {issue.level}: {issue.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-xl border border-ad-border bg-white p-5">
              <h3 className="text-sm font-semibold text-ad-ink">Export</h3>
              <p className="mt-1 text-xs text-ad-muted">
                A4 portrait, 300 DPI — 2480 × 3508.
                {plan.levels.length > 1 && ` One file per level — ${plan.levels.length} downloads.`}
              </p>
              <button
                type="button"
                onClick={() => void exportPng()}
                disabled={busy !== null}
                className={cn(buttonVariants({ variant: "accent" }), "mt-4 w-full")}
              >
                {busy === "export" ? "Rendering…" : "Download A4 .png"}
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadBlob(
                    JSON.stringify(plan, null, 2),
                    `${slugify(plan.address || "floor-plan")}-floor-plan.json`,
                    "application/json"
                  )
                }
                className={cn(buttonVariants({ variant: "outline" }), "mt-2 w-full")}
              >
                Download .json
              </button>
              <p className="mt-2 text-xs text-ad-muted">
                Keep the .json to reopen this plan later — for the POST survey, or a revision.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setPlan(null);
                setHistory([]);
                setSketchUrl(null);
                setSelection(null);
                setError(null);
              }}
              className={cn(buttonVariants({ variant: "outline" }), "w-full")}
            >
              Start again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
