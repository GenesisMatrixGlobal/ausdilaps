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

import { useRef, useState } from "react";
import {
  buildOwnerGrid,
  deriveWalls,
  labelAnchor,
  outdoorIds,
  placeDoors,
  subtractOpenings,
} from "@/lib/floor-plan/grid";
import { addFence, moveRoom, resizeRoom, updateDoor, type Edge } from "@/lib/floor-plan/edit";
import type { FloorPlan, Level } from "@/lib/floor-plan/types";

export type Selection =
  | { type: "room"; id: string }
  | { type: "door"; id: string }
  | { type: "fence"; id: string }
  | null;

/** "fence" turns the canvas into a drawing surface; "select" is the normal editing mode. */
export type Tool = "select" | "fence";

interface EditorProps {
  plan: FloorPlan;
  levelIndex: number;
  tool: Tool;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onChange: (level: Level) => void;
  onError: (message: string | null) => void;
}

type Drag =
  | { mode: "move"; roomId: string; from: { x: number; y: number }; base: Level }
  | { mode: "resize"; roomId: string; edge: Edge; from: { x: number; y: number }; base: Level }
  | { mode: "door"; doorId: string; from: { x: number; y: number }; base: Level; baseAt: number }
  // A fence run is drawn, not dragged from something existing, so it carries its own geometry
  // until it is committed on pointer-up.
  | { mode: "fence"; orient: "h" | "v"; pos: number; from: number; to: number }
  | null;

const STEEL = "#46688a";
const INK = "#2f343a";

export function FloorPlanEditor({
  plan,
  levelIndex,
  tool,
  selection,
  onSelect,
  onChange,
  onError,
}: EditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [preview, setPreview] = useState<Level | null>(null);

  const level = preview ?? plan.levels[levelIndex];
  const grid = plan.grid;
  const owner = buildOwnerGrid(level.rooms, grid);
  const walls = deriveWalls(owner, grid, outdoorIds(level.rooms));
  const { placed: doors } = placeDoors(owner, grid, level.doors);

  /** Pointer position in grid units. Uses the SVG's own transform, so it survives any scale. */
  function toGrid(e: React.PointerEvent): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
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

    if (drag.mode === "fence") {
      // Snap to the nearest grid line and extend along it. The axis is locked at pointer-down
      // so a wobbly drag cannot flip the run halfway through.
      const along = Math.round(drag.orient === "v" ? now.y : now.x);
      setDrag({ ...drag, to: along });
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
    const result = resizeRoom(drag.base, grid, drag.roomId, drag.edge, delta);
    if (result.ok) setPreview(result.level);
  }

  function onPointerUp() {
    if (!drag) return;

    if (drag.mode === "fence") {
      const from = Math.min(drag.from, drag.to);
      const to = Math.max(drag.from, drag.to);
      if (to > from) {
        const result = addFence(plan.levels[levelIndex], {
          orient: drag.orient,
          pos: drag.pos,
          from,
          to,
        });
        if (result.ok) onChange(result.level);
        else onError(result.error);
      }
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

  const handles: Array<{ edge: Edge; x: number; y: number; cursor: string }> = box
    ? [
        { edge: "n", x: box.x + box.w / 2, y: box.y, cursor: "ns-resize" },
        { edge: "s", x: box.x + box.w / 2, y: box.y + box.h, cursor: "ns-resize" },
        { edge: "w", x: box.x, y: box.y + box.h / 2, cursor: "ew-resize" },
        { edge: "e", x: box.x + box.w, y: box.y + box.h / 2, cursor: "ew-resize" },
      ]
    : [];

  return (
    <svg
      ref={svgRef}
      viewBox={`-0.5 -0.5 ${grid.w + 1} ${grid.h + 1}`}
      className="w-full touch-none select-none"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerDown={(e) => {
        if (tool !== "fence") {
          onSelect(null);
          return;
        }
        // Whichever axis the press is closer to a line on becomes the run's axis. Fences follow
        // boundaries, which on this grid are the lines between cells.
        const at = toGrid(e);
        const dx = Math.abs(at.x - Math.round(at.x));
        const dy = Math.abs(at.y - Math.round(at.y));
        const orient = dx <= dy ? "v" : "h";
        const pos = Math.round(orient === "v" ? at.x : at.y);
        const start = Math.round(orient === "v" ? at.y : at.x);
        (e.target as Element).setPointerCapture?.(e.pointerId);
        onError(null);
        setDrag({ mode: "fence", orient, pos, from: start, to: start });
      }}
      style={{ maxHeight: "70vh", cursor: tool === "fence" ? "crosshair" : undefined }}
    >
      <g stroke="#eef0f2" strokeWidth={0.02}>
        {Array.from({ length: grid.w + 1 }, (_, i) => (
          <line key={`v${i}`} x1={i} y1={0} x2={i} y2={grid.h} />
        ))}
        {Array.from({ length: grid.h + 1 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={i} x2={grid.w} y2={i} />
        ))}
      </g>

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

      {/* Must match the wall styling in lib/floor-plan/render.ts — this is the one thing the
          editor draws itself rather than sharing, so the two have to be kept in step. */}
      <g fill="none" strokeLinecap="butt" pointerEvents="none">
        {walls.flatMap((seg, i) =>
          subtractOpenings(seg, doors).map((piece, j) => {
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

      {/* Committed fences, plus the run being drawn. Same dashed grey the A4 renderer uses. */}
      <g fill="none" pointerEvents={tool === "fence" ? "none" : "auto"}>
        {level.fences.map((f) => {
          const isSelected = selection?.type === "fence" && selection.id === f.id;
          const p1 = f.orient === "v" ? { x: f.pos, y: f.from } : { x: f.from, y: f.pos };
          const p2 = f.orient === "v" ? { x: f.pos, y: f.to } : { x: f.to, y: f.pos };
          return (
            <g key={f.id}>
              <line
                x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                stroke={isSelected ? STEEL : "#9aa4ae"}
                strokeWidth={isSelected ? 0.12 : 0.09}
                strokeDasharray="0.3 0.2"
                pointerEvents="none"
              />
              <line
                x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                stroke="transparent"
                strokeWidth={0.5}
                pointerEvents="all"
                style={{ cursor: "pointer" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect({ type: "fence", id: f.id });
                }}
              />
            </g>
          );
        })}
        {drag?.mode === "fence" && (
          <line
            x1={drag.orient === "v" ? drag.pos : Math.min(drag.from, drag.to)}
            y1={drag.orient === "v" ? Math.min(drag.from, drag.to) : drag.pos}
            x2={drag.orient === "v" ? drag.pos : Math.max(drag.from, drag.to)}
            y2={drag.orient === "v" ? Math.max(drag.from, drag.to) : drag.pos}
            stroke={STEEL}
            strokeWidth={0.12}
            strokeDasharray="0.3 0.2"
            pointerEvents="none"
          />
        )}
      </g>

      {doors.map((door) => {
        const isSelected = selection?.type === "door" && selection.id === door.id;
        const w = door.to - door.from;
        const along = door.hingeAt === "from" ? 1 : -1;
        const hingeAlong = door.hingeAt === "from" ? door.from : door.to;
        const hx = door.orient === "v" ? door.pos : hingeAlong;
        const hy = door.orient === "v" ? hingeAlong : door.pos;
        const tip =
          door.orient === "v"
            ? { x: hx + door.swingDir * w, y: hy }
            : { x: hx, y: hy + door.swingDir * w };
        const jamb =
          door.orient === "v" ? { x: hx, y: hy + along * w } : { x: hx + along * w, y: hy };
        const turns = door.swingDir * along === 1;
        const sweep = door.orient === "v" ? (turns ? 1 : 0) : turns ? 0 : 1;

        const midAlong = (door.from + door.to) / 2;
        const midX = door.orient === "v" ? door.pos : midAlong;
        const midY = door.orient === "v" ? midAlong : door.pos;

        return (
          <g key={door.id}>
            <path
              d={`M${hx} ${hy}L${tip.x} ${tip.y}A${w} ${w} 0 0 ${sweep} ${jamb.x} ${jamb.y}`}
              stroke={isSelected ? STEEL : INK}
              strokeWidth={isSelected ? 0.1 : 0.07}
              fill="none"
              strokeDasharray={door.confidence === "inferred" ? 0.14 : undefined}
              pointerEvents="none"
            />
            {/* A visible dot on the opening — without it there is nothing on screen telling
                you a door is a thing you can take hold of. */}
            <circle
              cx={midX}
              cy={midY}
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

      <g pointerEvents="none">
        {level.rooms.map((room) => {
          const a = labelAnchor(room);
          return (
            <text
              key={room.id}
              x={a.x}
              y={a.y}
              fontSize={0.42}
              textAnchor="middle"
              dominantBaseline="central"
              fill={INK}
              fontFamily="Arial, Helvetica, sans-serif"
            >
              {room.label}
            </text>
          );
        })}
      </g>

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
  );
}
