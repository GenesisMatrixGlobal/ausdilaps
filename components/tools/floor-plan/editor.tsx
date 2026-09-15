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
  boundariesBetween,
  buildOwnerGrid,
  deriveWalls,
  labelAnchor,
  openingsFor,
  outdoorIds,
  placeDoors,
  stairGeometry,
  subtractOpenings,
} from "@/lib/floor-plan/grid";
import {
  addFence,
  addMark,
  addStair,
  moveRoom,
  resizeRoom,
  updateDoor,
  updateMark,
  updateStair,
  type Edge,
} from "@/lib/floor-plan/edit";
import type { FloorPlan, Level } from "@/lib/floor-plan/types";

export type Selection =
  | { type: "room"; id: string }
  | { type: "door"; id: string }
  | { type: "fence"; id: string }
  | { type: "mark"; id: string }
  | { type: "stair"; id: string }
  | null;

/** Anything but "select" turns the canvas into a drawing surface. */
export type Tool = "select" | "fence" | "number" | "stairs";

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
  onSelect: (selection: Selection) => void;
  onChange: (level: Level) => void;
  onError: (message: string | null) => void;
  /** Placed one, so the caller can step the number on. */
  onMarkPlaced: () => void;
}

type Drag =
  | { mode: "move"; roomId: string; from: { x: number; y: number }; base: Level }
  | { mode: "resize"; roomId: string; edge: Edge; from: { x: number; y: number }; base: Level }
  | { mode: "door"; doorId: string; from: { x: number; y: number }; base: Level; baseAt: number }
  // A fence run is drawn, not dragged from something existing, so it carries its own geometry
  // until it is committed on pointer-up.
  | { mode: "fence"; orient: "h" | "v"; pos: number; from: number; to: number }
  // Same story for a staircase, which is rubber-banded out in two axes rather than one.
  | { mode: "stair-draw"; x0: number; y0: number; x1: number; y1: number }
  | { mode: "mark"; markId: string; from: { x: number; y: number }; base: Level; baseAt: { x: number; y: number } }
  | { mode: "stair"; stairId: string; from: { x: number; y: number }; base: Level; baseAt: { x: number; y: number } }
  | null;

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
  onSelect,
  onChange,
  onError,
  onMarkPlaced,
}: EditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [preview, setPreview] = useState<Level | null>(null);

  const level = preview ?? plan.levels[levelIndex];
  const grid = plan.grid;
  const owner = buildOwnerGrid(level.rooms, grid);
  const walls = deriveWalls(owner, grid, outdoorIds(level.rooms));
  const { placed: doors } = placeDoors(owner, grid, level.doors);
  const openings = [...doors, ...openingsFor(owner, grid, level.removedWalls)];
  const marks = level.annotations.filter((a) => a.kind === "mark");
  // While a tool is drawing, nothing already on the canvas may swallow the press.
  const drawing = tool !== "select";

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

    if (drag.mode === "stair-draw") {
      setDrag({ ...drag, x1: Math.round(now.x), y1: Math.round(now.y) });
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

    if (drag.mode === "stair") {
      const base = drag.base.stairs.find((s) => s.id === drag.stairId);
      if (!base) return;
      // Whole cells, and kept on the grid rather than refused at the edge.
      const x = Math.min(Math.max(0, drag.baseAt.x + Math.round(now.x - drag.from.x)), grid.w - base.w);
      const y = Math.min(Math.max(0, drag.baseAt.y + Math.round(now.y - drag.from.y)), grid.h - base.h);
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

    if (drag.mode === "stair-draw") {
      const result = addStair(plan.levels[levelIndex], {
        x: Math.min(drag.x0, drag.x1),
        y: Math.min(drag.y0, drag.y1),
        w: Math.abs(drag.x1 - drag.x0),
        h: Math.abs(drag.y1 - drag.y0),
        dir: "up",
      });
      if (result.ok) onChange(result.level);
      else onError(result.error);
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

        (e.target as Element).setPointerCapture?.(e.pointerId);

        if (tool === "stairs") {
          const x = Math.round(at.x);
          const y = Math.round(at.y);
          setDrag({ mode: "stair-draw", x0: x, y0: y, x1: x, y1: y });
          return;
        }

        // Fence. Whichever axis the press is closer to a line on becomes the run's axis.
        // Fences follow boundaries, which on this grid are the lines between cells.
        const dx = Math.abs(at.x - Math.round(at.x));
        const dy = Math.abs(at.y - Math.round(at.y));
        const orient = dx <= dy ? "v" : "h";
        const pos = Math.round(orient === "v" ? at.x : at.y);
        const start = Math.round(orient === "v" ? at.y : at.x);
        setDrag({ mode: "fence", orient, pos, from: start, to: start });
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
        {drag?.mode === "stair-draw" && (
          <rect
            x={Math.min(drag.x0, drag.x1)}
            y={Math.min(drag.y0, drag.y1)}
            width={Math.abs(drag.x1 - drag.x0)}
            height={Math.abs(drag.y1 - drag.y0)}
            fill={STEEL}
            fillOpacity={0.12}
            stroke={STEEL}
            strokeWidth={0.08}
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

      {/* Committed fences, plus the run being drawn. Same dashed grey the A4 renderer uses. */}
      <g fill="none" pointerEvents={drawing ? "none" : "auto"}>
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

      <g pointerEvents={drawing ? "none" : "auto"}>
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
      </g>

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
