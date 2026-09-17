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
  setStairDirection,
  setLabelPlacement,
  setRoomKind,
  splitRoom,
  updateDoor,
  updateLine,
  updateMark,
  type EditResult,
} from "@/lib/floor-plan/edit";
import { renderPlan } from "@/lib/floor-plan/render";
import { a4Pixels, floorPlanSchema, OUTSIDE, type FloorPlan, type Level } from "@/lib/floor-plan/types";
import { DRAW_KINDS, FloorPlanEditor, type DrawKind, type Selection, type Tool } from "./editor";

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

export function FloorPlanTool() {
  const [plan, setPlan] = useState<FloorPlan | null>(null);
  const [history, setHistory] = useState<FloorPlan[]>([]);
  const [view, setView] = useState<"edit" | "sheet">("edit");
  const [tool, setTool] = useState<Tool>("select");
  /** So the Draw button returns you to whatever you were drawing last. */
  const [lastKind, setLastKind] = useState<DrawKind>("room");
  const [extendSelected, setExtendSelected] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
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
  const [markTone, setMarkTone] = useState<"defect" | "figure">("defect");
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

  const deleteSelection = useCallback(() => {
    if (!level || !selection) return;
    const result =
      selection.type === "room"
        ? deleteRoom(level, selection.id)
        : selection.type === "door"
          ? deleteDoor(level, selection.id)
          : selection.type === "line"
            ? deleteLine(level, selection.id)
            : selection.type === "stair"
              ? deleteStair(level, selection.id)
              : deleteMark(level, selection.id);
    if (result.ok) {
      setError(null);
      setLevel(result.level);
      setSelection(null);
    } else {
      setError(result.error);
    }
  }, [level, selection, setLevel]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // Don't hijack undo or delete while someone is typing a room name.
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        deleteSelection();
      }
      if (e.key === "Escape") setSelection(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, deleteSelection]);

  function startBlank() {
    setError(null);
    setPlan({
      address: "",
      grid: { w: 24, h: 18 },
      north: 0,
      northNote: "",
      orientation: "portrait",
      levels: [
        {
          id: "level-1",
          name: "Ground Level",
          rooms: [],
          doors: [],
          lines: [],
          removedWalls: [],
          stairs: [],
          annotations: [],
        },
      ],
    });
    setHistory([]);
    setLevelIndex(0);
    setSelection(null);
    setTool("room");
    setLastKind("room");
    setView("edit");
  }

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

  const selectedLine =
    level && selection?.type === "line" ? level.lines.find((l) => l.id === selection.id) : undefined;
  const selectedStair =
    level && selection?.type === "stair" ? level.stairs.find((s) => s.id === selection.id) : undefined;
  const selectedMark =
    level && selection?.type === "mark"
      ? level.annotations.find((a) => a.id === selection.id)
      : undefined;

  /** Only the walls the selected room actually has — the global list was mostly noise. */
  const roomWalls = useMemo(
    () => (selectedRoom ? walls.filter((w) => w.a === selectedRoom.id || w.b === selectedRoom.id) : []),
    [walls, selectedRoom]
  );

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
              reopen a saved .json plan
            </button>
            <span className="px-1.5 text-sm text-ad-muted">or</span>
            <button
              type="button"
              onClick={startBlank}
              className="text-sm text-ad-muted underline hover:text-ad-ink"
            >
              start a blank plan and draw it
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
                  {([
                    { key: "select", label: "Select" },
                    { key: "draw", label: "Draw" },
                  ] as const).map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => {
                        setTool(t.key === "select" ? "select" : lastKind);
                        if (t.key === "draw") setSelection(null);
                      }}
                      className={cn(
                        "rounded px-3 py-1 text-xs font-medium",
                        (t.key === "select") === (tool === "select")
                          ? "bg-ad-steel/10 text-ad-ink"
                          : "text-ad-muted hover:text-ad-ink"
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
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

            {/*
              Always on screen, even in Select mode. It used to appear only while drawing, which
              moved the canvas down by its own height every time you picked up a tool and back up
              again the moment you finished — so whatever you had just drawn jumped under the
              cursor. Dimmed rather than hidden; clicking a chip from Select picks that tool up.
            */}
            {view === "edit" && (
              <div className="mb-3 flex flex-wrap items-center gap-1 rounded-lg border border-ad-border bg-ad-surface p-1.5">
                {DRAW_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setTool(k);
                      setLastKind(k);
                      setSelection(null);
                    }}
                    className={cn(
                      "flex h-6 items-center rounded px-2.5 text-xs font-medium capitalize",
                      tool === k
                        ? "bg-white text-ad-ink shadow-sm"
                        : tool === "select"
                          ? "text-ad-muted/60 hover:text-ad-ink"
                          : "text-ad-muted hover:text-ad-ink"
                    )}
                  >
                    {k === "number" ? "№" : k}
                  </button>
                ))}
                {tool === "number" && (
                  <>
                    <input
                      value={markText}
                      // Digits and one dash: "3-4" is how two defects in one spot get written.
                      onChange={(e) => setMarkText(e.target.value.replace(/[^\d-]/g, "").slice(0, 9))}
                      inputMode="numeric"
                      aria-label="Number to place"
                      className="ml-1 h-6 w-16 rounded border border-ad-border px-1 text-center text-xs font-semibold outline-none focus:border-ad-steel"
                      style={{ color: markTone === "figure" ? "#1f2327" : "#d92b2b" }}
                    />
                    <div className="ml-1 flex h-6 overflow-hidden rounded border border-ad-border">
                      {([
                        { key: "defect", label: "Defect" },
                        { key: "figure", label: "Figure" },
                      ] as const).map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setMarkTone(t.key)}
                          className={cn(
                            "px-2 text-xs font-medium",
                            markTone === t.key
                              ? "bg-white text-ad-ink"
                              : "text-ad-muted hover:text-ad-ink"
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {(tool === "room" || tool === "outdoor") && selection?.type === "room" && (
                  <label className="ml-2 flex h-6 items-center gap-1.5 text-xs text-ad-muted">
                    <input
                      type="checkbox"
                      checked={extendSelected}
                      onChange={(e) => setExtendSelected(e.target.checked)}
                      className="accent-ad-steel"
                    />
                    Add to “{selectedRoom?.label || "selected"}”
                  </label>
                )}
              </div>
            )}

            <div className="rounded-xl border border-ad-border bg-white p-4">
              {view === "edit" ? (
                <FloorPlanEditor
                  plan={plan}
                  levelIndex={levelIndex}
                  tool={tool}
                  selection={selection}
                  highlightWall={hoverWall}
                  markText={markText}
                  markTone={markTone}
                  extendSelected={extendSelected}
                  onSelect={setSelection}
                  onChange={setLevel}
                  onError={setError}
                  onMarkPlaced={() =>
                    // Step on from the END of a range, so 3-4 is followed by 5.
                    setMarkText((n) => {
                      const last = Number(n.split("-").pop());
                      return Number.isFinite(last) ? String(Math.min(9999, last + 1)) : n;
                    })
                  }
                  // Back to Select once something is drawn, so the next click adjusts it
                  // rather than doing nothing — a drawing tool makes everything unhittable.
                  onDrew={() => setTool('select')}
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
                {tool === "select"
                  ? "Click anything to select it — a room, its name, a door, a line, a staircase, a number. Drag to move, drag a handle to resize. Backspace deletes, ⌘Z undoes. ⌘-scroll or pinch to zoom."
                  : tool === "door"
                    ? "Click on a wall. A door goes between the two rooms either side of it."
                    : tool === "number"
                      ? "Click anywhere to drop the number. It steps on by one each time."
                      : tool === "stairs"
                        ? "Drag out a rectangle where the stairs go."
                        : tool === "room" || tool === "outdoor"
                          ? "Drag out a rectangle. It takes any cells it covers from their current owner."
                          : "Drag along a grid line."}
              </p>
            )}
          </div>

          <div className="space-y-5">
            {/*
              One contextual panel, not six lists.
              The lists existed because things were hard to hit on the canvas; with zoom and
              honest hit targets you select the thing itself, so what is left is showing the
              selected thing's own controls. Walls are the exception and always were — they are
              derived, so there is nothing to click that is not already a resize handle. They
              live under the room they belong to instead, which is better scoped than a global
              list anyway.
            */}
            <div className="rounded-xl border border-ad-border bg-white p-5">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-ad-ink">
                  {selectedRoom
                    ? selectedRoom.kind === "outdoor" ? "Outdoor area" : "Room"
                    : selectedDoor
                      ? "Door"
                      : selectedLine
                        ? selectedLine.kind === "fence" ? "Fence" : selectedLine.kind === "wall" ? "Wall" : "Counter"
                        : selectedStair
                          ? "Staircase"
                          : selectedMark
                            ? "Number"
                            : "Nothing selected"}
                </h3>
                {selection && (
                  <button
                    type="button"
                    onClick={() => setSelection(null)}
                    className="text-xs text-ad-muted hover:text-ad-ink"
                  >
                    Deselect
                  </button>
                )}
              </div>

              {!selection && (
                <p className="mt-2 text-xs text-ad-muted">
                  Click anything on the plan to select it — a room, its name, a door, a line, a
                  staircase, a number. Its controls appear here. Backspace deletes.
                </p>
              )}

              {selectedRoom && (
                <>
                  <input
                    value={selectedRoom.label}
                    ref={nameRef}
                    onChange={(e) =>
                      apply(renameRoom(level, selectedRoom.id, e.target.value), `rename:${selectedRoom.id}`)
                    }
                    className="mt-2 w-full rounded-lg border border-ad-border p-2 text-sm outline-none focus:border-ad-steel"
                  />
                  <div className="mt-2 flex gap-1 rounded-lg border border-ad-border p-1">
                    {([
                      { key: "room", label: "Room" },
                      { key: "outdoor", label: "Outdoor" },
                    ] as const).map((k) => (
                      <button
                        key={k.key}
                        type="button"
                        onClick={() => apply(setRoomKind(level, selectedRoom.id, k.key))}
                        className={cn(
                          "flex-1 rounded px-2 py-1 text-xs font-medium",
                          selectedRoom.kind === k.key
                            ? "bg-ad-steel/10 text-ad-ink"
                            : "text-ad-muted hover:text-ad-ink"
                        )}
                      >
                        {k.label}
                      </button>
                    ))}
                  </div>

                  <p className="mt-4 text-xs font-medium text-ad-ink">Name</p>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        apply(
                          setLabelPlacement(level, selectedRoom.id, {
                            labelAngle: selectedRoom.labelAngle === 90 ? 0 : 90,
                          })
                        )
                      }
                      className="rounded-lg border border-ad-border bg-white px-2 py-1.5 text-xs font-medium text-ad-ink hover:border-ad-steel"
                    >
                      {selectedRoom.labelAngle === 90 ? "Lay flat" : "Turn upright"}
                    </button>
                    <button
                      type="button"
                      disabled={selectedRoom.labelDx === 0 && selectedRoom.labelDy === 0}
                      onClick={() =>
                        apply(setLabelPlacement(level, selectedRoom.id, { labelDx: 0, labelDy: 0 }))
                      }
                      className="rounded-lg border border-ad-border bg-white px-2 py-1.5 text-xs font-medium text-ad-ink hover:border-ad-steel disabled:opacity-40"
                    >
                      Re-centre
                    </button>
                  </div>

                  {roomWalls.length > 0 && (
                    <>
                      <p className="mt-4 text-xs font-medium text-ad-ink">Walls</p>
                      <ul className="mt-1 space-y-0.5">
                        {roomWalls.map((w) => (
                          <li
                            key={w.key}
                            className="flex items-center gap-1"
                            onMouseEnter={() => setHoverWall({ a: w.a, b: w.b })}
                            onMouseLeave={() => setHoverWall(null)}
                          >
                            <span
                              className={cn(
                                "flex-1 truncate px-1 py-0.5 text-xs",
                                w.removed ? "text-ad-muted line-through" : "text-ad-muted"
                              )}
                            >
                              to {roomLabel(w.a === selectedRoom.id ? w.b : w.a)}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                apply(
                                  w.removed
                                    ? restoreWall(level, w.removed.id)
                                    : removeWall(level, w.a, w.b)
                                )
                              }
                              className="shrink-0 rounded px-2 py-0.5 text-xs text-ad-muted hover:bg-ad-surface hover:text-ad-ink"
                            >
                              {w.removed ? "Restore" : "Remove"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  <p className="mt-4 text-xs font-medium text-ad-ink">Add a door to…</p>
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
                </>
              )}

              {selectedDoor && (
                <>
                  <p className="mt-1 text-xs text-ad-muted">
                    {roomLabel(selectedDoor.a)} → {roomLabel(selectedDoor.b)}
                  </p>
                  <div className="mt-3 flex gap-1 rounded-lg border border-ad-border p-1">
                    {([
                      { key: "swing", label: "Swing" },
                      { key: "double", label: "Double" },
                      { key: "sliding", label: "Sliding" },
                      { key: "opening", label: "Open" },
                    ] as const).map((k) => (
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
                      className="rounded-lg border border-ad-border bg-white px-2 py-1.5 text-xs font-medium text-ad-ink hover:border-ad-steel disabled:opacity-40"
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
                </>
              )}

              {selectedLine && (
                <>
                  <p className="mt-1 text-xs text-ad-muted">
                    {selectedLine.orient === "v" ? "Vertical" : "Horizontal"} ·{" "}
                    {Math.round(selectedLine.to - selectedLine.from)} cells
                  </p>
                  <div className="mt-3 flex gap-1 rounded-lg border border-ad-border p-1">
                    {([
                      { key: "fence", label: "Fence" },
                      { key: "wall", label: "Wall" },
                      { key: "counter", label: "Counter" },
                    ] as const).map((k) => (
                      <button
                        key={k.key}
                        type="button"
                        onClick={() => apply(updateLine(level, selectedLine.id, { kind: k.key }))}
                        className={cn(
                          "flex-1 rounded px-1.5 py-1 text-xs font-medium",
                          selectedLine.kind === k.key
                            ? "bg-ad-steel/10 text-ad-ink"
                            : "text-ad-muted hover:text-ad-ink"
                        )}
                      >
                        {k.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      apply(
                        updateLine(level, selectedLine.id, {
                          gate:
                            selectedLine.gate !== undefined
                              ? undefined
                              : Math.round((selectedLine.from + selectedLine.to) / 2 - 0.5),
                        })
                      )
                    }
                    className="mt-2 w-full rounded-lg border border-ad-border bg-white px-2 py-1.5 text-xs font-medium text-ad-ink hover:border-ad-steel"
                  >
                    {selectedLine.gate !== undefined ? "Remove the gate" : "Add a gate"}
                  </button>
                </>
              )}

              {selectedStair && (
                <>
                  <p className="mt-1 text-xs text-ad-muted">
                    {selectedStair.w} × {selectedStair.h} cells
                  </p>
                  {/* One control, not a rotate and a flip: the flight runs the way the arrow
                      points, so naming the direction says everything. Picking one that crosses
                      the current one turns the footprint with it. */}
                  <p className="mt-3 text-xs font-medium text-ad-ink">Going</p>
                  <div className="mt-1 grid grid-cols-4 gap-1">
                    {([
                      { key: "up", glyph: "↑", label: "Up the page" },
                      { key: "down", glyph: "↓", label: "Down the page" },
                      { key: "left", glyph: "←", label: "Left" },
                      { key: "right", glyph: "→", label: "Right" },
                    ] as const).map((d) => (
                      <button
                        key={d.key}
                        type="button"
                        title={d.label}
                        aria-label={d.label}
                        onClick={() => apply(setStairDirection(level, plan.grid, selectedStair.id, d.key))}
                        className={cn(
                          "rounded-lg border px-2 py-1.5 text-sm font-medium",
                          selectedStair.dir === d.key
                            ? "border-ad-steel bg-ad-steel/10 text-ad-ink"
                            : "border-ad-border bg-white text-ad-muted hover:border-ad-steel hover:text-ad-ink"
                        )}
                      >
                        {d.glyph}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-ad-muted">Drag a handle to resize it.</p>
                </>
              )}

              {selectedMark && (
                <>
                  <input
                    value={selectedMark.text}
                    inputMode="numeric"
                    aria-label="Number"
                    onChange={(e) =>
                      apply(
                        updateMark(level, selectedMark.id, {
                          text: e.target.value.replace(/[^\d-]/g, "").slice(0, 9),
                        }),
                        `mark:${selectedMark.id}`
                      )
                    }
                    className="mt-2 w-28 rounded-lg border border-ad-border p-2 text-center text-sm font-semibold outline-none focus:border-ad-steel"
                    style={{ color: selectedMark.tone === "figure" ? "#1f2327" : "#d92b2b" }}
                  />
                  <div className="mt-2 flex gap-1 rounded-lg border border-ad-border p-1">
                    {([
                      { key: "defect", label: "Defect" },
                      { key: "figure", label: "Figure" },
                    ] as const).map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => apply(updateMark(level, selectedMark.id, { tone: t.key }))}
                        className={cn(
                          "flex-1 rounded px-2 py-1 text-xs font-medium",
                          selectedMark.tone === t.key
                            ? "bg-ad-steel/10 text-ad-ink"
                            : "text-ad-muted hover:text-ad-ink"
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-ad-muted">
                    Up to 9999, or a range like 3-4 where two defects share a spot.
                  </p>
                </>
              )}

              {selection && (
                <button
                  type="button"
                  onClick={deleteSelection}
                  className="mt-4 w-full rounded-lg border border-ad-orange px-2 py-1.5 text-xs font-medium text-ad-ink hover:bg-ad-orange/10"
                >
                  Delete
                </button>
              )}
            </div>

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
                Subheading
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

            {issues.length > 0 && (
              <div className="rounded-xl border border-ad-orange bg-ad-orange/10 p-5">
                <h3 className="text-sm font-semibold text-ad-ink">Worth checking</h3>
                <ul className="mt-2 space-y-1 text-xs text-ad-ink">
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
