"use client";

// Floor Plan tool — sketch photo in, A4 PNG out.
//
// Replaces ~13 minutes of tracing walls by hand in EdrawMax per plan. Claude reads the
// sketch into rooms-on-a-grid; the walls are computed from that, not drawn.
//
// Two views over one plan: Edit is the working canvas, Sheet is the actual A4 output from
// the same renderer the export uses. The photo-range chips render already — only the tray
// that fills them from Salesforce is still to come.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { downloadBlob } from "@/components/tools/shared/download";
import { validateLevel } from "@/lib/floor-plan/grid";
import {
  addDoor,
  deleteDoor,
  deleteRoom,
  doorCandidates,
  renameRoom,
  updateDoor,
  type EditResult,
} from "@/lib/floor-plan/edit";
import { renderPlan } from "@/lib/floor-plan/render";
import { floorPlanSchema, OUTSIDE, type FloorPlan, type Level } from "@/lib/floor-plan/types";
import { FloorPlanEditor, type Selection } from "./editor";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_UNDO = 40;

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "floor-plan";
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mimeType });
}

function readAsBase64(file: File): Promise<string> {
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
  const [levelIndex, setLevelIndex] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [sketchUrl, setSketchUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"extract" | "export" | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  const level = plan?.levels[levelIndex];

  const svg = useMemo(
    () => (plan && view === "sheet" ? renderPlan(plan, { mode: "preview", dpi: 150 }) : null),
    [plan, view]
  );

  const issues = useMemo(() => {
    if (!plan) return [];
    return plan.levels.flatMap((lvl) =>
      validateLevel(lvl, plan.grid).map((i) => ({ ...i, level: lvl.name }))
    );
  }, [plan]);

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
      const image = await readAsBase64(file);
      setSketchUrl(URL.createObjectURL(file));
      const res = await fetch("/api/floor-plan/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image, mediaType: file.type }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; plan?: FloorPlan; error?: string }
        | null;
      if (!json?.ok || !json.plan) throw new Error(json?.error ?? "Could not read that sketch.");
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

  async function exportPng() {
    if (!plan) return;
    setError(null);
    setBusy("export");
    try {
      const res = await fetch("/api/floor-plan/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan, dpi: 300 }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; image?: string; error?: string }
        | null;
      if (!json?.ok || !json.image) throw new Error(json?.error ?? "Could not render the plan.");

      const url = URL.createObjectURL(base64ToBlob(json.image, "image/png"));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugify(plan.address || "floor-plan")}-floor-plan.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
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
                  selection={selection}
                  onSelect={setSelection}
                  onChange={setLevel}
                  onError={setError}
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
                Click a room to select it. Drag it to move, drag a handle to resize — growing a room
                takes space from its neighbour, so a handle on a shared wall moves that wall. Drag a
                door along its wall to reposition it. ⌘Z undoes.
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
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
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
              Every door, listed. Selecting one on the canvas means hitting a doorway-sized
              target, which is a sliver on screen at any sensible zoom — so removing a door
              cannot be a canvas-only gesture. This also puts the inferred ones somewhere you
              can review them as a set rather than hunting for dashes in the drawing.
            */}
            <div className="rounded-xl border border-ad-border bg-white p-5">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-ad-ink">Doors</h3>
                <span className="text-xs text-ad-muted">{level.doors.length}</span>
              </div>
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
              <p className="mt-1 text-xs text-ad-muted">A4 portrait, 300 DPI — 2480 × 3508.</p>
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

            {sketchUrl && (
              <div className="rounded-xl border border-ad-border bg-white p-5">
                <h3 className="text-sm font-semibold text-ad-ink">Original sketch</h3>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sketchUrl} alt="Uploaded sketch" className="mt-3 w-full rounded-lg" />
              </div>
            )}

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
