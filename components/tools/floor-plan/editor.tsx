"use client";

// The interactive canvas.
//
// It draws from the same grid.ts helpers the A4 renderer uses, so the editor and the sheet
// can never disagree about where a wall is. What differs is only presentation: this one is
// measured in grid cells rather than page pixels, and adds the things you edit with —
// selection, handles, hit targets.
//
// Dragging works against a level frozen at pointer-down, so a drag is always one edit
// evaluated from a fixed starting point rather than a compounding series of small ones.
// Every intermediate state goes through the same pure functions as the commit, which is why
// the live preview is exactly what you get when you let go.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  boundariesBetween,
  buildOwnerGrid,
  deriveWalls,
  doorGeometry,
  labelAnchor,
  openingsFor,
  outdoorIds,
  placeDoors,
  stairGeometry,
  subtractOpenings,
} from "@/lib/floor-plan/grid";
import {
  addDoor,
  addLine,
  addMark,
  addRect,
  addStair,
  moveRoom,
  resizeRoom,
  resizeStair,
  setLabelPlacement,
  updateDoor,
  updateMark,
  updateStair,
  type Edge,
} from "@/lib/floor-plan/edit";
import { OUTSIDE, type FloorPlan, type Level, type Line } from "@/lib/floor-plan/types";

export type Selection =
  | { type: "room"; id: string }
  | { type: "door"; id: string }
  | { type: "line"; id: string }
  | { type: "mark"; id: string }
  | { type: "stair"; id: string }
  | null;

/**
 * What the Draw palette can put on the plan. Every one of these is the same gesture applied to
 * a different thing, which is the point: adding another is an entry in a list, not a feature.
 */
export const DRAW_KINDS = ["room", "outdoor", "wall", "counter", "fence", "stairs", "door", "number"] as const;
export type DrawKind = (typeof DRAW_KINDS)[number];

/** Anything but "select" turns the canvas into a drawing surface. */
export type Tool = "select" | DrawKind;

/** Drag out a rectangle. */
const RECT_KINDS = new Set<Tool>(["room", "outdoor", "stairs"]);
/** Drag along a grid line. */
const LINE_KINDS = new Set<Tool>(["wall", "counter", "fence"]);

interface EditorProps {
  plan: FloorPlan;
  levelIndex: number;
  tool: Tool;
  selection: Selection;
  /** The wall pair under the cursor in the Walls list, drawn highlighted so you can see which
   *  one you are about to remove. */
  highlightWall?: { a: string; b: string } | null;
  /** The value the Number tool will place next. */
  markText: string;
  /** With a room selected, a drawn rectangle joins it instead of starting a new one. */
  extendSelected: boolean;
  onSelect: (selection: Selection) => void;
  onChange: (level: Level) => void;
  onError: (message: string | null) => void;
  /** Placed one, so the caller can step the number on. */
  onMarkPlaced: () => void;
}

type Point = { x: number; y: number };

type Drag =
  | { mode: "move"; roomId: string; from: Point; base: Level }
  | { mode: "resize"; roomId: string; edge: Edge; from: Point; base: Level }
  | { mode: "door"; doorId: string; from: Point; base: Level; baseAt: number }
  | { mode: "mark"; markId: string; from: Point; base: Level; baseAt: Point }
  | { mode: "stair"; stairId: string; from: Point; base: Level; baseAt: Point }
  | { mode: "stair-resize"; stairId: string; edge: Edge; from: Point; base: Level }
  | { mode: "label"; roomId: string; from: Point; base: Level; baseAt: Point }
  // Drawn, not dragged from something that exists, so these carry their own geometry until
  // pointer-up commits them.
  | { mode: "line"; kind: Line["kind"]; orient: "h" | "v"; pos: number; from: number; to: number }
  | { mode: "rect"; kind: "room" | "outdoor" | "stairs"; x0: number; y0: number; x1: number; y1: number }
  | { mode: "pan"; from: Point; base: Box }
  | null;

/** The visible window on the grid, in grid units. */
type Box = { x: number; y: number; w: number; h: number };

const MIN_SPAN = 4;
const ZOOM_STEP = 1.25;

const STEEL = "#46688a";
const INK = "#2f343a";
/** Must match MARK_RED in lib/floor-plan/render.ts. */
const MARK_RED = "#d92b2b";

export function FloorPlanEditor({
  plan,
  levelIndex,
  tool,
  selection,
  highlightWall,
  markText,
  extendSelected,
  onSelect,
  onChange,
  onError,
  onMarkPlaced,
}: EditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [preview, setPreview] = useState<Level | null>(null);
  const [view, setView] = useState<{ box: Box; key: string } | null>(null);

  const level = preview ?? plan.levels[levelIndex];
  const grid = plan.grid;
  const fitBox: Box = { x: -0.5, y: -0.5, w: grid.w + 1, h: grid.h + 1 };
  const viewKey = `${grid.w}x${grid.h}:${levelIndex}`;
  const viewBox = view && view.key === viewKey ? view.box : fitBox;
  const owner = buildOwnerGrid(level.rooms, grid);
  const walls = deriveWalls(owner, grid, outdoorIds(level.rooms));
  const { placed: doors } = placeDoors(owner, grid, level.doors);
  const openings = [...doors, ...openingsFor(owner, grid, level.removedWalls)];
  const marks = level.annotations.filter((a) => a.kind === "mark");
  // While a tool is drawing, nothing already on the canvas may swallow the press.
  const drawing = tool !== "select";

  /** Pointer position in grid units. Uses the SVG's own transform, so it survives any zoom. */
  const clientToGrid = useCallback((cx: number, cy: number): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  function toGrid(e: React.PointerEvent): Point {
    return clientToGrid(e.clientX, e.clientY);
  }

  const gw = grid.w + 1;
  const gh = grid.h + 1;

  const putView = useCallback((next: Box) => setView({ box: next, key: viewKey }), [viewKey]);
  const updateView = useCallback(
    (fn: (cur: Box) => Box) =>
      setView((cur) => ({
        box: fn(cur && cur.key === viewKey ? cur.box : { x: -0.5, y: -0.5, w: gw, h: gh }),
        key: viewKey,
      })),
    [viewKey, gw, gh]
  );

  /** Keep the window inside the grid, and never let it shrink past a few cells. */
  const clampBox = useCallback(
    (b: Box): Box => {
      const w = Math.min(Math.max(MIN_SPAN, b.w), gw);
      const h = b.h * (w / b.w);
      return {
        w,
        h,
        x: Math.min(Math.max(b.x, -0.5), -0.5 + gw - w),
        y: Math.min(Math.max(b.y, -0.5), -0.5 + gh - h),
      };
    },
    [gw, gh]
  );

  /** Scale about a fixed grid point, so whatever is under the cursor stays under it. */
  const zoomBy = useCallback(
    (factor: number, focus: Point) => {
      updateView((b) => {
        const w = Math.min(Math.max(MIN_SPAN, b.w / factor), gw);
        const k = w / b.w;
        return clampBox({
          x: focus.x - (focus.x - b.x) * k,
          y: focus.y - (focus.y - b.y) * k,
          w,
          h: b.h * k,
        });
      });
    },
    [gw, clampBox, updateView]
  );

  // React's onWheel is passive, so it cannot preventDefault and the page scrolls instead.
  // Pinch on a trackpad arrives as a wheel event with ctrlKey set; a plain wheel pans.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.min(4, Math.max(0.25, Math.exp(-e.deltaY * 0.01)));
        zoomBy(factor, clientToGrid(e.clientX, e.clientY));
        return;
      }
      updateView((b) => {
        const perPx = b.w / Math.max(1, svg.clientWidth);
        return clampBox({ ...b, x: b.x + e.deltaX * perPx, y: b.y + e.deltaY * perPx });
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomBy, clientToGrid, clampBox, updateView]);

  /**
   * The wall line nearest a point, and who is either side of it.
   *
   * This is what makes "click a wall to put a door in it" work: a door is stored as the pair
   * of rooms it joins, and the pair is exactly what a wall line already tells you.
   */
  function wallAt(p: Point): { a: string; b: string; orient: "h" | "v"; pos: number; at: number } | null {
    const cell = (x: number, y: number) =>
      x < 0 || y < 0 || x >= grid.w || y >= grid.h ? null : owner[y][x];

    const vx = Math.round(p.x);
    const hy = Math.round(p.y);
    const vertical = Math.abs(p.x - vx) <= Math.abs(p.y - hy);

    const lo = vertical ? cell(vx - 1, Math.floor(p.y)) : cell(Math.floor(p.x), hy - 1);
    const hi = vertical ? cell(vx, Math.floor(p.y)) : cell(Math.floor(p.x), hy);
    if (lo === hi) return null;

    return {
      a: lo ?? OUTSIDE,
      b: hi ?? OUTSIDE,
      orient: vertical ? "v" : "h",
      pos: vertical ? vx : hy,
      at: Math.floor(vertical ? p.y : p.x),
    };
  }

  function begin(e: React.PointerEvent, next: Drag) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onError(null);
    setDrag(next);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const now = toGrid(e);

    if (drag.mode === "line") {
      // Snap to the nearest grid line and extend along it. The axis is locked at pointer-down
      // so a wobbly drag cannot flip the run halfway through.
      const along = Math.round(drag.orient === "v" ? now.y : now.x);
      setDrag({ ...drag, to: along });
      return;
    }

    if (drag.mode === "rect") {
      setDrag({ ...drag, x1: Math.round(now.x), y1: Math.round(now.y) });
      return;
    }

    if (drag.mode === "pan") {
      // The pointer has already moved with the content, so read the delta in SCREEN terms and
      // convert once — using grid coords here would chase its own tail.
      const svg = svgRef.current;
      const perPx = drag.base.w / Math.max(1, svg?.clientWidth ?? 1);
      putView(
        clampBox({
          ...drag.base,
          x: drag.base.x - (e.clientX - drag.from.x) * perPx,
          y: drag.base.y - (e.clientY - drag.from.y) * perPx,
        })
      );
      return;
    }

    if (drag.mode === "mark") {
      // No snap: a mark names a point on the drawing, not a cell.
      const result = updateMark(drag.base, drag.markId, {
        anchor: {
          type: "free",
          x: drag.baseAt.x + (now.x - drag.from.x),
          y: drag.baseAt.y + (now.y - drag.from.y),
        },
      });
      if (result.ok) setPreview(result.level);
      return;
    }

    if (drag.mode === "label") {
      // Free, like a mark: the whole point is to put the name where the room's centre is busy.
      const result = setLabelPlacement(drag.base, drag.roomId, {
        labelDx: drag.baseAt.x + (now.x - drag.from.x),
        labelDy: drag.baseAt.y + (now.y - drag.from.y),
      });
      if (result.ok) setPreview(result.level);
      return;
    }

    if (drag.mode === "stair") {
      const base = drag.base.stairs.find((s) => s.id === drag.stairId);
      if (!base) return;
      // Half cells — see stairSchema. Kept on the grid rather than refused at the edge.
      const step = (d: number) => Math.round(d * 2) / 2;
      const x = Math.min(Math.max(0, drag.baseAt.x + step(now.x - drag.from.x)), grid.w - base.w);
      const y = Math.min(Math.max(0, drag.baseAt.y + step(now.y - drag.from.y)), grid.h - base.h);
      const result = updateStair(drag.base, drag.stairId, { x, y });
      if (result.ok) setPreview(result.level);
      return;
    }

    if (drag.mode === "door") {
      const base = drag.base.doors.find((d) => d.id === drag.doorId);
      if (!base) return;
      const placement = placeDoors(
        buildOwnerGrid(drag.base.rooms, grid),
        grid,
        [base]
      ).placed[0];
      if (!placement) return;
      const delta = placement.orient === "v" ? now.y - drag.from.y : now.x - drag.from.x;
      // Half-cell steps: a doorway reads fine centred between two cells, and whole-cell
      // stepping makes short walls impossible to place a door on neatly.
      const at = Math.round((drag.baseAt + delta) * 2) / 2;
      const result = updateDoor(drag.base, drag.doorId, { at });
      if (result.ok) setPreview(result.level);
      return;
    }

    const dx = Math.round(now.x - drag.from.x);
    const dy = Math.round(now.y - drag.from.y);

    if (drag.mode === "move") {
      if (dx === 0 && dy === 0) {
        setPreview(drag.base);
        return;
      }
      const result = moveRoom(drag.base, grid, drag.roomId, dx, dy);
      // A refused drag holds the last good state rather than snapping back mid-gesture.
      if (result.ok) setPreview(result.level);
      return;
    }

    // Outward is positive whichever edge is being pulled.
    const delta =
      drag.edge === "e" ? dx : drag.edge === "w" ? -dx : drag.edge === "s" ? dy : -dy;
    if (delta === 0) {
      setPreview(drag.base);
      return;
    }
    const result =
      drag.mode === "stair-resize"
        ? resizeStair(drag.base, grid, drag.stairId, drag.edge, delta)
        : resizeRoom(drag.base, grid, drag.roomId, drag.edge, delta);
    if (result.ok) setPreview(result.level);
  }

  function onPointerUp() {
    if (!drag) return;

    if (drag.mode === "line") {
      const from = Math.min(drag.from, drag.to);
      const to = Math.max(drag.from, drag.to);
      if (to > from) {
        const result = addLine(plan.levels[levelIndex], {
          orient: drag.orient,
          pos: drag.pos,
          from,
          to,
          kind: drag.kind,
        });
        if (result.ok) onChange(result.level);
        else onError(result.error);
      }
      setDrag(null);
      return;
    }

    if (drag.mode === "rect") {
      const x = Math.min(drag.x0, drag.x1);
      const y = Math.min(drag.y0, drag.y1);
      const w = Math.abs(drag.x1 - drag.x0);
      const h = Math.abs(drag.y1 - drag.y0);
      const target = plan.levels[levelIndex];

      let result;
      if (drag.kind === "stairs") {
        result = addStair(target, { x, y, w, h, dir: "up" });
      } else if (extendSelected && selection?.type === "room") {
        result = addRect(target, grid, { x, y, w, h }, { roomId: selection.id });
      } else {
        const kind = drag.kind === "outdoor" ? "outdoor" : "room";
        const n = target.rooms.filter((r) => r.kind === kind).length + 1;
        result = addRect(target, grid, { x, y, w, h }, {
          label: kind === "outdoor" ? `Area ${n}` : `Room ${n}`,
          kind,
        });
      }

      if (result.ok) onChange(result.level);
      else onError(result.error);
      setDrag(null);
      return;
    }

    if (drag.mode === "pan") {
      setDrag(null);
      return;
    }

    if (preview && preview !== drag.base) onChange(preview);
    setDrag(null);
    setPreview(null);
  }


  const selectedRoom =
    selection?.type === "room" ? level.rooms.find((r) => r.id === selection.id) : undefined;

  let box: { x: number; y: number; w: number; h: number } | null = null;
  if (selectedRoom) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of selectedRoom.rects) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    }
    box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  const edgeHandles = (b: { x: number; y: number; w: number; h: number } | null) =>
    b
      ? ([
          { edge: "n", x: b.x + b.w / 2, y: b.y, cursor: "ns-resize" },
          { edge: "s", x: b.x + b.w / 2, y: b.y + b.h, cursor: "ns-resize" },
          { edge: "w", x: b.x, y: b.y + b.h / 2, cursor: "ew-resize" },
          { edge: "e", x: b.x + b.w, y: b.y + b.h / 2, cursor: "ew-resize" },
        ] as Array<{ edge: Edge; x: number; y: number; cursor: string }>)
      : [];

  const handles = edgeHandles(box);

  const selectedStair =
    selection?.type === "stair" ? level.stairs.find((s) => s.id === selection.id) : undefined;
  const stairBox = selectedStair
    ? { x: selectedStair.x, y: selectedStair.y, w: selectedStair.w, h: selectedStair.h }
    : null;
  const stairHandles = edgeHandles(stairBox);

  const centre: Point = { x: viewBox.x + viewBox.w / 2, y: viewBox.y + viewBox.h / 2 };
  const zoomed = viewBox.w < fitBox.w - 0.001;

  return (
    <div className="relative">
      {/* On-screen controls as well as the gestures. A pinch nobody knows about is not a
          feature — the same lesson as "delete a door" and "rename a room". */}
      <div className="absolute right-2 top-2 z-10 flex flex-col overflow-hidden rounded-lg border border-ad-border bg-white/90 text-ad-muted shadow-sm backdrop-blur">
        {[
          { label: "+", title: "Zoom in", on: () => zoomBy(ZOOM_STEP, centre) },
          { label: "−", title: "Zoom out", on: () => zoomBy(1 / ZOOM_STEP, centre) },
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            title={b.title}
            onClick={b.on}
            className="h-7 w-7 text-sm leading-none hover:bg-ad-surface hover:text-ad-ink"
          >
            {b.label}
          </button>
        ))}
        <button
          type="button"
          title="Fit the whole plan"
          onClick={() => setView(null)}
          disabled={!zoomed}
          className="h-7 w-7 border-t border-ad-border text-[0.6rem] hover:bg-ad-surface hover:text-ad-ink disabled:opacity-40"
        >
          Fit
        </button>
      </div>
    <svg
      ref={svgRef}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      className="w-full touch-none select-none"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerDown={(e) => {
        // Middle button pans in any mode, which is what a middle button does everywhere else.
        if (e.button === 1) {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setDrag({ mode: "pan", from: { x: e.clientX, y: e.clientY }, base: viewBox });
          return;
        }
        if (tool === "select") {
          onSelect(null);
          return;
        }
        const at = toGrid(e);
        onError(null);

        if (tool === "number") {
          const result = addMark(plan.levels[levelIndex], at.x, at.y, markText);
          if (result.ok) {
            onChange(result.level);
            onMarkPlaced();
          } else onError(result.error);
          return;
        }

        if (tool === "door") {
          // A door is stored as the pair of rooms it joins, and a wall line is exactly that
          // pair — so clicking the wall IS naming the door.
          const hit = wallAt(at);
          if (!hit) {
            onError("Click on a wall — a door goes between two rooms.");
            return;
          }
          const target = plan.levels[levelIndex];
          const added = addDoor(target, hit.a, hit.b);
          if (!added.ok) {
            onError(added.error);
            return;
          }
          // Hang it on the wall that was actually clicked, at the point clicked.
          const placed = added.level.doors[added.level.doors.length - 1];
          const put = updateDoor(added.level, placed.id, {
            wall: { orient: hit.orient, pos: hit.pos },
            at: hit.at,
          });
          if (put.ok) {
            onChange(put.level);
            onSelect({ type: "door", id: placed.id });
          } else onError(put.error);
          return;
        }

        (e.target as Element).setPointerCapture?.(e.pointerId);

        if (!RECT_KINDS.has(tool) && !LINE_KINDS.has(tool)) return;

        if (RECT_KINDS.has(tool)) {
          const x = Math.round(at.x);
          const y = Math.round(at.y);
          setDrag({ mode: "rect", kind: tool as "room" | "outdoor" | "stairs", x0: x, y0: y, x1: x, y1: y });
          return;
        }

        // A line. Whichever axis the press is closer to a line on becomes the run's axis —
        // these follow boundaries, which on this grid are the lines between cells.
        const dx = Math.abs(at.x - Math.round(at.x));
        const dy = Math.abs(at.y - Math.round(at.y));
        const orient = dx <= dy ? "v" : "h";
        const pos = Math.round(orient === "v" ? at.x : at.y);
        const start = Math.round(orient === "v" ? at.y : at.x);
        setDrag({ mode: "line", kind: tool as Line["kind"], orient, pos, from: start, to: start });
      }}
      style={{ maxHeight: "70vh", cursor: drawing ? "crosshair" : undefined }}
    >
      <g stroke="#eef0f2" strokeWidth={0.02}>
        {Array.from({ length: grid.w + 1 }, (_, i) => (
          <line key={`v${i}`} x1={i} y1={0} x2={i} y2={grid.h} />
        ))}
        {Array.from({ length: grid.h + 1 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={i} x2={grid.w} y2={i} />
        ))}
      </g>

      <g pointerEvents={drawing ? "none" : "auto"}>
      {level.rooms.map((room) => {
        const isSelected = selection?.type === "room" && selection.id === room.id;
        return (
          <g
            key={room.id}
            onPointerDown={(e) => {
              onSelect({ type: "room", id: room.id });
              begin(e, {
                mode: "move",
                roomId: room.id,
                from: toGrid(e),
                base: plan.levels[levelIndex],
              });
            }}
            style={{ cursor: "move" }}
          >
            {room.rects.map((r, i) => (
              <rect
                key={i}
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                fill={isSelected ? STEEL : "#ffffff"}
                fillOpacity={isSelected ? 0.14 : 0.01}
              />
            ))}
          </g>
        );
      })}
      </g>

      {/* Staircases, over the rooms but UNDER the walls — the symbol is filled white so its
          treads read, and one drawn flush to a wall would otherwise rub that wall out. Same
          geometry the A4 renderer draws from. */}
      <g pointerEvents={drawing ? "none" : "auto"}>
        {level.stairs.map((stair) => {
          const g = stairGeometry(stair);
          const isSelected = selection?.type === "stair" && selection.id === stair.id;
          const ink = isSelected ? STEEL : INK;
          return (
            <g
              key={stair.id}
              style={{ cursor: "move" }}
              onPointerDown={(e) => {
                onSelect({ type: "stair", id: stair.id });
                begin(e, {
                  mode: "stair",
                  stairId: stair.id,
                  from: toGrid(e),
                  base: plan.levels[levelIndex],
                  baseAt: { x: stair.x, y: stair.y },
                });
              }}
            >
              <rect
                x={g.outline.x}
                y={g.outline.y}
                width={g.outline.w}
                height={g.outline.h}
                fill="#ffffff"
                stroke={ink}
                strokeWidth={isSelected ? 0.09 : 0.06}
              />
              <g fill="none" stroke={ink} strokeWidth={0.05} pointerEvents="none">
                {g.treads.map(([x1, y1, x2, y2], i) => (
                  <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
                ))}
                <line x1={g.arrow.x1} y1={g.arrow.y1} x2={g.arrow.x2} y2={g.arrow.y2} />
              </g>
              <polygon
                points={g.arrow.head.map(([x, y]) => `${x},${y}`).join(" ")}
                fill={ink}
                pointerEvents="none"
              />
            </g>
          );
        })}
        {drag?.mode === "rect" && (
          <rect
            x={Math.min(drag.x0, drag.x1)}
            y={Math.min(drag.y0, drag.y1)}
            width={Math.abs(drag.x1 - drag.x0)}
            height={Math.abs(drag.y1 - drag.y0)}
            fill={STEEL}
            fillOpacity={0.12}
            stroke={STEEL}
            strokeWidth={0.08}
            strokeDasharray={drag.kind === "outdoor" ? "0.3 0.2" : undefined}
            pointerEvents="none"
          />
        )}
      </g>

      {/* Must match the wall styling in lib/floor-plan/render.ts — this is the one thing the
          editor draws itself rather than sharing, so the two have to be kept in step. */}
      <g fill="none" strokeLinecap="butt" pointerEvents="none">
        {walls.flatMap((seg, i) =>
          subtractOpenings(seg, openings).map((piece, j) => {
            const isArea = seg.kind === "area";
            const props = {
              stroke: isArea ? "#9aa4ae" : INK,
              strokeWidth: seg.kind === "external" ? 0.16 : 0.09,
              strokeDasharray: isArea ? "0.3 0.2" : undefined,
            };
            return seg.orient === "v" ? (
              <line key={`${i}-${j}`} x1={seg.pos} y1={piece.from} x2={seg.pos} y2={piece.to} {...props} />
            ) : (
              <line key={`${i}-${j}`} x1={piece.from} y1={seg.pos} x2={piece.to} y2={seg.pos} {...props} />
            );
          })
        )}
      </g>

      {highlightWall && (
        <g pointerEvents="none">
          {boundariesBetween(owner, grid, highlightWall.a, highlightWall.b).map((b, i) => (
            <line
              key={i}
              x1={b.orient === "v" ? b.pos : b.index}
              y1={b.orient === "v" ? b.index : b.pos}
              x2={b.orient === "v" ? b.pos : b.index + 1}
              y2={b.orient === "v" ? b.index + 1 : b.pos}
              stroke={STEEL}
              strokeWidth={0.3}
              strokeOpacity={0.45}
              strokeLinecap="butt"
            />
          ))}
        </g>
      )}

      {/* Drawn lines, plus the run being drawn. Must match drawLines() in render.ts. */}
      <g fill="none" pointerEvents={drawing ? "none" : "auto"}>
        {level.lines.map((line) => {
          const isSelected = selection?.type === "line" && selection.id === line.id;
          const gateTo = line.gate === undefined ? 0 : Math.min(line.gate + 1, line.to);
          const open = line.gate !== undefined && line.gate > line.from && line.gate < line.to;
          const pieces: Array<[number, number]> = open
            ? ([[line.from, line.gate!], [gateTo, line.to]].filter(([a, b]) => b > a) as Array<[number, number]>)
            : [[line.from, line.to]];
          const fence = line.kind === "fence";
          const offsets = line.kind === "counter" ? [-0.07, 0.07] : [0];
          const stroke = isSelected ? STEEL : fence ? "#9aa4ae" : INK;

          const at = (along: number, off: number) =>
            line.orient === "v" ? { x: line.pos + off, y: along } : { x: along, y: line.pos + off };

          return (
            <g key={line.id}>
              {pieces.flatMap(([from, to], i) =>
                offsets.map((off, j) => {
                  const p1 = at(from, off);
                  const p2 = at(to, off);
                  return (
                    <line
                      key={`${i}-${j}`}
                      x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                      stroke={stroke}
                      strokeWidth={line.kind === "counter" ? 0.055 : isSelected ? 0.12 : 0.09}
                      strokeDasharray={fence ? "0.3 0.2" : undefined}
                      pointerEvents="none"
                    />
                  );
                })
              )}
              {/* One grab line over the whole run, gate included — the gap is not a hole you
                  should have to aim around to select the thing. */}
              <line
                x1={at(line.from, 0).x} y1={at(line.from, 0).y}
                x2={at(line.to, 0).x} y2={at(line.to, 0).y}
                stroke="transparent"
                strokeWidth={0.5}
                pointerEvents="all"
                style={{ cursor: "pointer" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect({ type: "line", id: line.id });
                }}
              />
            </g>
          );
        })}
        {drag?.mode === "line" && (
          <line
            x1={drag.orient === "v" ? drag.pos : Math.min(drag.from, drag.to)}
            y1={drag.orient === "v" ? Math.min(drag.from, drag.to) : drag.pos}
            x2={drag.orient === "v" ? drag.pos : Math.max(drag.from, drag.to)}
            y2={drag.orient === "v" ? Math.max(drag.from, drag.to) : drag.pos}
            stroke={STEEL}
            strokeWidth={0.12}
            strokeDasharray={drag.kind === "fence" ? "0.3 0.2" : undefined}
            pointerEvents="none"
          />
        )}
      </g>

      <g pointerEvents={drawing ? "none" : "auto"}>
      {doors.map((door) => {
        const isSelected = selection?.type === "door" && selection.id === door.id;
        // Same geometry the A4 renderer draws from, so the canvas cannot disagree with the
        // sheet about what a door looks like.
        const g = doorGeometry(door);
        const stroke = isSelected ? STEEL : INK;
        const width = isSelected ? 0.1 : 0.07;

        return (
          <g key={door.id}>
            {g.leaves.map((leaf, i) => (
              <path
                key={i}
                d={`M${leaf.hinge.x} ${leaf.hinge.y}L${leaf.tip.x} ${leaf.tip.y}A${leaf.radius} ${leaf.radius} 0 0 ${leaf.sweep} ${leaf.jamb.x} ${leaf.jamb.y}`}
                stroke={stroke}
                strokeWidth={width}
                fill="none"
                pointerEvents="none"
              />
            ))}
            {g.panels.map(([x1, y1, x2, y2], i) => (
              <line
                key={`p${i}`}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={stroke}
                strokeWidth={width}
                pointerEvents="none"
              />
            ))}
            {/* A visible dot on the opening — without it there is nothing on screen telling
                you a door is a thing you can take hold of. */}
            <circle
              cx={g.mid.x}
              cy={g.mid.y}
              r={isSelected ? 0.24 : 0.16}
              fill="#ffffff"
              stroke={isSelected ? STEEL : "#9aa4ae"}
              strokeWidth={0.06}
              pointerEvents="none"
            />
            {/*
              Grab target. Two things matter here and both were wrong first time round:
              pointerEvents="all" so hit-testing does not depend on the stroke being painted
              (a transparent stroke is unreliable under the default visiblePainted), and a
              target overhanging the opening at both ends — a doorway is about one cell, which
              is a ~14px sliver on screen and essentially unclickable.
            */}
            <line
              x1={door.orient === "v" ? door.pos : door.from - 0.35}
              y1={door.orient === "v" ? door.from - 0.35 : door.pos}
              x2={door.orient === "v" ? door.pos : door.to + 0.35}
              y2={door.orient === "v" ? door.to + 0.35 : door.pos}
              stroke="transparent"
              strokeWidth={1}
              pointerEvents="all"
              style={{ cursor: door.orient === "v" ? "ns-resize" : "ew-resize" }}
              onPointerDown={(e) => {
                onSelect({ type: "door", id: door.id });
                begin(e, {
                  mode: "door",
                  doorId: door.id,
                  from: toGrid(e),
                  base: plan.levels[levelIndex],
                  baseAt: door.from,
                });
              }}
            />
          </g>
        );
      })}
      </g>

      {/* Room names. Draggable, because the anchor is the centre of the room's biggest rect
          and that is exactly where a staircase or a number tends to be.
          Only once the room is SELECTED, though: the grab box is invisible and sits above
          everything, so while it was always live it covered whatever was under the name —
          a staircase in the middle of a room could not be picked up at all. */}
      <g pointerEvents="none">
        {level.rooms.map((room) => {
          const a = labelAnchor(room);
          const nudged = room.labelDx !== 0 || room.labelDy !== 0;
          const width = Math.max(1, room.label.length * 0.22);
          const grabbable = !drawing && selection?.type === "room" && selection.id === room.id;
          return (
            <g
              key={room.id}
              transform={room.labelAngle === 90 ? `rotate(-90 ${a.x} ${a.y})` : undefined}
              style={{ cursor: grabbable ? "move" : undefined }}
              onPointerDown={(e) => {
                if (!grabbable) return;
                begin(e, {
                  mode: "label",
                  roomId: room.id,
                  from: toGrid(e),
                  base: plan.levels[levelIndex],
                  baseAt: { x: room.labelDx, y: room.labelDy },
                });
              }}
            >
              <text
                x={a.x}
                y={a.y}
                fontSize={0.42}
                textAnchor="middle"
                dominantBaseline="central"
                fill={INK}
                fontFamily="Arial, Helvetica, sans-serif"
                pointerEvents="none"
              >
                {room.label}
              </text>
              {/* Text is a ragged hit target; grab a box around it instead. */}
              <rect
                x={a.x - width / 2}
                y={a.y - 0.3}
                width={width}
                height={0.6}
                fill="transparent"
                pointerEvents={grabbable ? "all" : "none"}
              />
              {nudged && (
                <line
                  x1={a.x - room.labelDx}
                  y1={a.y - room.labelDy}
                  x2={a.x}
                  y2={a.y}
                  stroke={STEEL}
                  strokeWidth={0.03}
                  strokeDasharray="0.12 0.1"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}
      </g>

      <g pointerEvents={drawing ? "none" : "auto"}>
        {marks.map((mark) => {
          if (mark.anchor.type !== "free") return null;
          const { x, y } = mark.anchor;
          const isSelected = selection?.type === "mark" && selection.id === mark.id;
          return (
            <g key={mark.id}>
              {isSelected && (
                <circle cx={x} cy={y} r={0.42} fill={STEEL} fillOpacity={0.16} pointerEvents="none" />
              )}
              <text
                x={x}
                y={y}
                fontSize={0.52}
                fontWeight={700}
                textAnchor="middle"
                dominantBaseline="central"
                fill={MARK_RED}
                stroke="#ffffff"
                strokeWidth={0.17}
                strokeLinejoin="round"
                paintOrder="stroke"
                fontFamily="Arial, Helvetica, sans-serif"
                pointerEvents="none"
              >
                {mark.text}
              </text>
              {/* Text is a poor hit target at this size; grab a disc around it instead. */}
              <circle
                cx={x}
                cy={y}
                r={0.42}
                fill="transparent"
                pointerEvents="all"
                style={{ cursor: "move" }}
                onPointerDown={(e) => {
                  onSelect({ type: "mark", id: mark.id });
                  begin(e, {
                    mode: "mark",
                    markId: mark.id,
                    from: toGrid(e),
                    base: plan.levels[levelIndex],
                    baseAt: { x, y },
                  });
                }}
              />
            </g>
          );
        })}
      </g>

      {stairBox && (
        <g>
          <rect
            x={stairBox.x}
            y={stairBox.y}
            width={stairBox.w}
            height={stairBox.h}
            fill="none"
            stroke={STEEL}
            strokeWidth={0.05}
            strokeDasharray={0.2}
            pointerEvents="none"
          />
          {stairHandles.map((h) => (
            <rect
              key={h.edge}
              x={h.x - 0.28}
              y={h.y - 0.28}
              width={0.56}
              height={0.56}
              rx={0.12}
              fill="#ffffff"
              stroke={STEEL}
              strokeWidth={0.06}
              style={{ cursor: h.cursor }}
              onPointerDown={(e) =>
                begin(e, {
                  mode: "stair-resize",
                  stairId: selection!.id,
                  edge: h.edge,
                  from: toGrid(e),
                  base: plan.levels[levelIndex],
                })
              }
            />
          ))}
        </g>
      )}

      {box && (
        <g>
          <rect
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            fill="none"
            stroke={STEEL}
            strokeWidth={0.05}
            strokeDasharray={0.2}
            pointerEvents="none"
          />
          {handles.map((h) => (
            <rect
              key={h.edge}
              x={h.x - 0.28}
              y={h.y - 0.28}
              width={0.56}
              height={0.56}
              rx={0.12}
              fill="#ffffff"
              stroke={STEEL}
              strokeWidth={0.06}
              style={{ cursor: h.cursor }}
              onPointerDown={(e) =>
                begin(e, {
                  mode: "resize",
                  roomId: selection!.id,
                  edge: h.edge,
                  from: toGrid(e),
                  base: plan.levels[levelIndex],
                })
              }
            />
          ))}
        </g>
      )}
    </svg>
    </div>
  );
}
