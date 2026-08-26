// Floor Plan geometry. Pure functions, no I/O, no React — everything here is derived from
// cell ownership and can be reasoned about on its own.
//
// The idea the whole tool rests on: a hand sketch IS a grid of rectangles, so let the model
// place rooms on a grid and compute the walls ourselves. Wall geometry stops being something
// a model can get subtly wrong and becomes arithmetic — closed loops, clean T-junctions and
// square corners every time, and an edit re-derives instead of being patched.

import { OUTSIDE, type Door, type Level, type Rect, type Room } from "./types";

export type Owner = string | null;
export type Grid = { w: number; h: number };

/** Cell ownership. `null` is outside the building. Later rects win on overlap. */
export function buildOwnerGrid(rooms: Room[], grid: Grid): Owner[][] {
  const owner: Owner[][] = Array.from({ length: grid.h }, () => Array<Owner>(grid.w).fill(null));
  for (const room of rooms) {
    for (const r of room.rects) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (x >= 0 && y >= 0 && x < grid.w && y < grid.h) owner[y][x] = room.id;
        }
      }
    }
  }
  return owner;
}

function at(owner: Owner[][], grid: Grid, x: number, y: number): Owner {
  if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) return null;
  return owner[y][x];
}

/**
 * A run of wall along one grid line.
 *
 * `orient: "v"` → a vertical wall on column line `pos`, spanning rows `from`..`to`.
 * `orient: "h"` → a horizontal wall on row line `pos`, spanning columns `from`..`to`.
 * All values are in grid units, so a wall is positioned on the line between cells.
 */
export type WallSeg = {
  orient: "h" | "v";
  pos: number;
  from: number;
  to: number;
  /** True when one side is outside the building — drawn heavier. */
  external: boolean;
};

/**
 * Every wall in the level, as merged runs.
 *
 * A wall exists wherever two adjacent cells have different owners. Merging collinear
 * neighbours matters for output quality as much as size: butt-jointed unit strokes show
 * seams when rasterised, one long stroke does not.
 */
export function deriveWalls(owner: Owner[][], grid: Grid): WallSeg[] {
  const segs: WallSeg[] = [];

  // Vertical: boundary on column line x sits between cell (x-1, y) and (x, y).
  for (let x = 0; x <= grid.w; x++) {
    let run: WallSeg | null = null;
    for (let y = 0; y < grid.h; y++) {
      const left = at(owner, grid, x - 1, y);
      const right = at(owner, grid, x, y);
      const isWall = left !== right;
      const external = isWall && (left === null || right === null);
      if (isWall && run && run.external === external && run.to === y) {
        run.to = y + 1;
      } else {
        if (run) segs.push(run);
        run = isWall ? { orient: "v", pos: x, from: y, to: y + 1, external } : null;
      }
    }
    if (run) segs.push(run);
  }

  // Horizontal: boundary on row line y sits between cell (x, y-1) and (x, y).
  for (let y = 0; y <= grid.h; y++) {
    let run: WallSeg | null = null;
    for (let x = 0; x < grid.w; x++) {
      const above = at(owner, grid, x, y - 1);
      const below = at(owner, grid, x, y);
      const isWall = above !== below;
      const external = isWall && (above === null || below === null);
      if (isWall && run && run.external === external && run.to === x) {
        run.to = x + 1;
      } else {
        if (run) segs.push(run);
        run = isWall ? { orient: "h", pos: y, from: x, to: x + 1, external } : null;
      }
    }
    if (run) segs.push(run);
  }

  return segs;
}

/** One unit-length piece of boundary between two specific owners. */
type Boundary = { orient: "h" | "v"; pos: number; index: number; lowSide: Owner; highSide: Owner };

function boundariesBetween(owner: Owner[][], grid: Grid, a: string, b: string): Boundary[] {
  const want = (p: Owner, q: Owner) =>
    (p === a && q === b) || (p === b && q === a) || (a === OUTSIDE && p === null && q === b) ||
    (b === OUTSIDE && p === null && q === a) || (a === OUTSIDE && q === null && p === b) ||
    (b === OUTSIDE && q === null && p === a);

  const out: Boundary[] = [];
  for (let x = 0; x <= grid.w; x++)
    for (let y = 0; y < grid.h; y++) {
      const lo = at(owner, grid, x - 1, y);
      const hi = at(owner, grid, x, y);
      if (lo !== hi && want(lo, hi)) out.push({ orient: "v", pos: x, index: y, lowSide: lo, highSide: hi });
    }
  for (let y = 0; y <= grid.h; y++)
    for (let x = 0; x < grid.w; x++) {
      const lo = at(owner, grid, x, y - 1);
      const hi = at(owner, grid, x, y);
      if (lo !== hi && want(lo, hi)) out.push({ orient: "h", pos: y, index: x, lowSide: lo, highSide: hi });
    }
  return out;
}

/** Where a door physically lands: an opening on a wall line, plus which way the leaf swings. */
export type DoorPlacement = {
  id: string;
  orient: "h" | "v";
  pos: number;
  from: number;
  to: number;
  /** Along the wall line, which end the door is hinged at. */
  hingeAt: "from" | "to";
  /** -1 opens toward decreasing x (vertical wall) or y (horizontal); +1 the other way. */
  swingDir: -1 | 1;
  kind: "swing" | "opening";
  confidence: "visible" | "inferred";
};

const MAX_DOOR_CELLS = 1;

/**
 * Resolve stored doors (a pair of rooms) into openings on the wall they share.
 *
 * A door whose rooms no longer touch resolves to nothing and is returned in `unplaced` —
 * that is the honest outcome of dragging two rooms apart, and the editor can surface it
 * rather than drawing a door into empty space.
 */
export function placeDoors(
  owner: Owner[][],
  grid: Grid,
  doors: Door[]
): { placed: DoorPlacement[]; unplaced: Door[] } {
  const placed: DoorPlacement[] = [];
  const unplaced: Door[] = [];

  for (const door of doors) {
    const bounds = boundariesBetween(owner, grid, door.a, door.b);
    if (bounds.length === 0) {
      unplaced.push(door);
      continue;
    }

    // Longest contiguous stretch of shared wall — the most sensible place to hang a door.
    const byLine = new Map<string, Boundary[]>();
    for (const b of bounds) {
      const key = `${b.orient}:${b.pos}`;
      const list = byLine.get(key);
      if (list) list.push(b);
      else byLine.set(key, [b]);
    }

    const runs: Boundary[][] = [];
    for (const list of byLine.values()) {
      list.sort((p, q) => p.index - q.index);
      let run: Boundary[] = [];
      for (const b of list) {
        if (run.length === 0 || b.index === run[run.length - 1].index + 1) run.push(b);
        else {
          runs.push(run);
          run = [b];
        }
      }
      if (run.length > 0) runs.push(run);
    }
    if (runs.length === 0) {
      unplaced.push(door);
      continue;
    }

    const longest = runs.reduce((best, r) => (r.length > best.length ? r : best), runs[0]);
    // A dragged door names where it sits; honour the run under it. If the rooms have since
    // moved so nothing shares wall there any more, fall back to centring on the longest run
    // rather than dropping the door on the floor.
    const chosen =
      door.at === undefined
        ? longest
        : runs.find((r) => door.at! >= r[0].index && door.at! <= r[r.length - 1].index + 1) ?? longest;

    const runStart = chosen[0].index;
    const runLen = chosen.length;
    // Leave wall either side of the opening; a door flush to a corner reads as a mistake.
    const width = Math.min(MAX_DOOR_CELLS, Math.max(0.5, runLen * 0.5));
    const centred = runStart + (runLen - width) / 2;
    const from =
      door.at === undefined
        ? centred
        : Math.min(Math.max(door.at, runStart), runStart + runLen - width);

    // swingInto names a room; turn that into a direction along the axis.
    const swingRoom = door.swingInto === "a" ? door.a : door.b;
    const sample = chosen[0];
    const highIsSwingRoom =
      sample.highSide === swingRoom || (swingRoom === OUTSIDE && sample.highSide === null);
    const swingDir: -1 | 1 = highIsSwingRoom ? 1 : -1;

    placed.push({
      id: door.id,
      orient: sample.orient,
      pos: sample.pos,
      from,
      to: from + width,
      hingeAt: door.hinge === "end" ? "to" : "from",
      swingDir,
      kind: door.kind,
      confidence: door.confidence,
    });
  }

  return { placed, unplaced };
}

/** The rect a label should sit in — the room's biggest piece, so an L-shape never puts text outside itself. */
export function labelRect(room: Room): Rect {
  return room.rects.reduce((best, r) => (r.w * r.h > best.w * best.h ? r : best), room.rects[0]);
}

export function labelAnchor(room: Room): { x: number; y: number } {
  const r = labelRect(room);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Cut door openings out of the wall runs they sit on. */
export function subtractOpenings(seg: WallSeg, doors: DoorPlacement[]): Array<{ from: number; to: number }> {
  const holes = doors
    .filter((d) => d.orient === seg.orient && d.pos === seg.pos && d.to > seg.from && d.from < seg.to)
    .map((d) => ({ from: Math.max(d.from, seg.from), to: Math.min(d.to, seg.to) }))
    .sort((a, b) => a.from - b.from);

  const pieces: Array<{ from: number; to: number }> = [];
  let cursor = seg.from;
  for (const hole of holes) {
    if (hole.from > cursor) pieces.push({ from: cursor, to: hole.from });
    cursor = Math.max(cursor, hole.to);
  }
  if (cursor < seg.to) pieces.push({ from: cursor, to: seg.to });
  return pieces;
}

export type Cell = { x: number; y: number };

const key = (x: number, y: number) => `${x},${y}`;

/** Every cell a room owns. */
export function roomCells(room: Room): Set<string> {
  const cells = new Set<string>();
  for (const r of room.rects)
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cells.add(key(x, y));
  return cells;
}

/**
 * Cells back to rectangles.
 *
 * Editing works on cells — it is the only representation where "drag this wall one across"
 * is unambiguous — but rooms are stored as rects. Without this, every drag would append
 * another 1x1 rect and a room would slowly become hundreds of them.
 *
 * Greedy: take the widest run on a row, then extend it down as far as the rows below match.
 * Not a minimal decomposition, but it collapses the overwhelmingly common case (a room that
 * is still a plain rectangle) back to exactly one rect, which is what keeps resize handles
 * meaningful.
 */
export function rectsFromCells(cells: Set<string>): Rect[] {
  const remaining = new Set(cells);
  const rects: Rect[] = [];

  const parse = (k: string) => {
    const [x, y] = k.split(",").map(Number);
    return { x, y };
  };

  while (remaining.size > 0) {
    // Top-most, then left-most, so output is stable rather than dependent on Set order.
    let start = { x: Infinity, y: Infinity };
    for (const k of remaining) {
      const c = parse(k);
      if (c.y < start.y || (c.y === start.y && c.x < start.x)) start = c;
    }

    let w = 0;
    while (remaining.has(key(start.x + w, start.y))) w++;

    let h = 1;
    for (;;) {
      let full = true;
      for (let dx = 0; dx < w; dx++) {
        if (!remaining.has(key(start.x + dx, start.y + h))) {
          full = false;
          break;
        }
      }
      if (!full) break;
      h++;
    }

    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++) remaining.delete(key(start.x + dx, start.y + dy));
    rects.push({ x: start.x, y: start.y, w, h });
  }

  return rects;
}

/** Fraction of the building's footprint above which a hole is left alone. */
const MAX_REPAIRABLE_HOLE_RATIO = 0.05;

/**
 * Absorb small unassigned holes inside the building into the room that surrounds them most.
 *
 * The model places rooms as separate rectangles, so a run can leave a cell or two unclaimed
 * between them. Those read as jagged stubs and phantom internal walls, because a hole has a
 * boundary like any other room. Observed on the reference sketch: one run tiled perfectly,
 * the next left an 8-cell hole.
 *
 * Two deliberate limits. A hole larger than a twentieth of the footprint is left alone and
 * reported instead — at that size it is more likely a real void (a courtyard, a stairwell)
 * than a seam, and swallowing it would erase something the inspector drew. And only cells
 * strictly inside the footprint are touched, never the outline, so the building's shape is
 * never invented.
 */
export function repairInteriorGaps(rooms: Room[], grid: Grid): { rooms: Room[]; filled: number } {
  if (rooms.length === 0) return { rooms, filled: 0 };

  const owner = buildOwnerGrid(rooms, grid);
  const bounds = levelBounds(owner, grid);
  const footprint = rooms.reduce((n, r) => n + r.rects.reduce((m, c) => m + c.w * c.h, 0), 0);

  const holes: Array<{ x: number; y: number }> = [];
  for (let y = bounds.y; y < bounds.y + bounds.h; y++)
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) if (!owner[y][x]) holes.push({ x, y });

  if (holes.length === 0 || holes.length > footprint * MAX_REPAIRABLE_HOLE_RATIO) {
    return { rooms, filled: 0 };
  }

  const extra = new Map<string, Rect[]>();
  let remaining = holes;
  let filled = 0;

  // Iterate: a two-cell-thick hole only exposes its inner cell once the outer one is claimed.
  while (remaining.length > 0) {
    const still: Array<{ x: number; y: number }> = [];
    let progressed = false;

    for (const cell of remaining) {
      const votes = new Map<string, number>();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const id = at(owner, grid, cell.x + dx, cell.y + dy);
        if (id) votes.set(id, (votes.get(id) ?? 0) + 1);
      }
      if (votes.size === 0) {
        still.push(cell);
        continue;
      }
      let bestId = "";
      let bestVotes = -1;
      // Sorted so a tie resolves the same way on every run rather than by Map order.
      for (const [id, n] of [...votes].sort((p, q) => (q[1] - p[1]) || p[0].localeCompare(q[0]))) {
        if (n > bestVotes) {
          bestVotes = n;
          bestId = id;
        }
      }
      owner[cell.y][cell.x] = bestId;
      const list = extra.get(bestId) ?? [];
      list.push({ x: cell.x, y: cell.y, w: 1, h: 1 });
      extra.set(bestId, list);
      filled++;
      progressed = true;
    }

    if (!progressed) break;
    remaining = still;
  }

  return {
    rooms: rooms.map((room) =>
      extra.has(room.id) ? { ...room, rects: [...room.rects, ...extra.get(room.id)!] } : room
    ),
    filled,
  };
}

export type PlanIssue = { kind: "overlap" | "gap" | "unplaced-door" | "empty"; detail: string };

/**
 * Structural problems worth showing a human.
 *
 * Overlaps are silent data loss (one room eats another's cells); an interior gap is a hole
 * in the building. Neither throws — the plan still renders — so they have to be surfaced.
 */
export function validateLevel(level: Level, grid: Grid): PlanIssue[] {
  const issues: PlanIssue[] = [];
  if (level.rooms.length === 0) {
    issues.push({ kind: "empty", detail: `${level.name} has no rooms.` });
    return issues;
  }

  const seen: Owner[][] = Array.from({ length: grid.h }, () => Array<Owner>(grid.w).fill(null));
  const overlapped = new Set<string>();
  for (const room of level.rooms)
    for (const r of room.rects)
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) {
          if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) continue;
          const prev = seen[y][x];
          if (prev && prev !== room.id) overlapped.add(`${prev}|${room.id}`);
          seen[y][x] = room.id;
        }
  for (const pair of overlapped) {
    const [a, b] = pair.split("|");
    const name = (id: string) => level.rooms.find((r) => r.id === id)?.label ?? id;
    issues.push({ kind: "overlap", detail: `${name(a)} and ${name(b)} overlap.` });
  }

  // A hole strictly inside the building's bounding box — an unlabelled void, not open ground.
  const owner = buildOwnerGrid(level.rooms, grid);
  let minX = grid.w, minY = grid.h, maxX = -1, maxY = -1;
  for (let y = 0; y < grid.h; y++)
    for (let x = 0; x < grid.w; x++)
      if (owner[y][x]) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
  let gaps = 0;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (!owner[y][x]) gaps++;
  if (gaps > 0) {
    issues.push({ kind: "gap", detail: `${gaps} unassigned cell${gaps === 1 ? "" : "s"} inside the building.` });
  }

  const { unplaced } = placeDoors(owner, grid, level.doors);
  for (const d of unplaced) {
    const name = (id: string) => (id === OUTSIDE ? "outside" : level.rooms.find((r) => r.id === id)?.label ?? id);
    issues.push({ kind: "unplaced-door", detail: `Door ${name(d.a)} → ${name(d.b)} has no shared wall.` });
  }

  return issues;
}

/** Tight bounds of the drawn building, in grid units. */
export function levelBounds(owner: Owner[][], grid: Grid) {
  let minX = grid.w, minY = grid.h, maxX = 0, maxY = 0, any = false;
  for (let y = 0; y < grid.h; y++)
    for (let x = 0; x < grid.w; x++)
      if (owner[y][x]) {
        any = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + 1 > maxX) maxX = x + 1;
        if (y + 1 > maxY) maxY = y + 1;
      }
  if (!any) return { x: 0, y: 0, w: grid.w, h: grid.h };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
