// Plan editing. Pure functions: every operation takes a level and returns a new one, or an
// error explaining why it was refused. Nothing here touches React or the DOM.
//
// One mechanism underneath everything. Rooms are a map of cell -> owner; an edit paints new
// ownership over that map, then the plan is rebuilt from it. Because the rooms tile the
// building, dragging a room's edge is the same operation as dragging the wall between it and
// its neighbour — one grows, the other gives way, and the tiling is preserved by
// construction rather than by cleanup afterwards.

import { rectsFromCells, repairInteriorGaps, roomCells } from "./grid";
import { OUTSIDE, type Door, type Level, type Room } from "./types";

export type Grid = { w: number; h: number };
export type EditResult = { ok: true; level: Level } | { ok: false; error: string };
export type Edge = "n" | "s" | "e" | "w";

const key = (x: number, y: number) => `${x},${y}`;

function ownerMap(rooms: Room[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const room of rooms)
    for (const k of roomCells(room)) map.set(k, room.id);
  return map;
}

/**
 * Rebuild a level from a cell map.
 *
 * Refuses rather than repairs when a room has been painted out of existence — silently
 * deleting a room because a drag passed over it is the kind of loss you notice three edits
 * later, with nothing left to undo back to.
 */
function fromOwnerMap(level: Level, grid: Grid, map: Map<string, string>): EditResult {
  const cellsById = new Map<string, Set<string>>();
  for (const [cell, id] of map) {
    const set = cellsById.get(id) ?? new Set<string>();
    set.add(cell);
    cellsById.set(id, set);
  }

  const erased = level.rooms.filter((r) => !cellsById.has(r.id));
  if (erased.length > 0) {
    return {
      ok: false,
      error: `That would cover ${erased.map((r) => r.label || "an unnamed room").join(" and ")} completely.`,
    };
  }

  const rooms: Room[] = level.rooms.map((room) => ({
    ...room,
    rects: rectsFromCells(cellsById.get(room.id)!),
  }));

  // A drag vacates the cells it came from; close those before anything derives walls.
  const { rooms: repaired } = repairInteriorGaps(rooms, grid);
  return { ok: true, level: { ...level, rooms: repaired } };
}

function boundingBox(room: Room) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of room.rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Slide a whole room. Cells it lands on change hands; cells it leaves are healed. */
export function moveRoom(level: Level, grid: Grid, roomId: string, dx: number, dy: number): EditResult {
  const room = level.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Room not found." };
  if (dx === 0 && dy === 0) return { ok: true, level };

  // Clamp at the sheet edge rather than refusing. Mid-drag, a hard stop reads as the room
  // hitting a wall; an error banner reads as something broken.
  const box = boundingBox(room);
  const cdx = Math.max(-box.x, Math.min(dx, grid.w - (box.x + box.w)));
  const cdy = Math.max(-box.y, Math.min(dy, grid.h - (box.y + box.h)));
  if (cdx === 0 && cdy === 0) return { ok: true, level };

  const map = ownerMap(level.rooms);
  for (const k of roomCells(room)) map.delete(k);
  for (const k of roomCells(room)) {
    const [x, y] = k.split(",").map(Number);
    map.set(key(x + cdx, y + cdy), roomId);
  }
  return fromOwnerMap(level, grid, map);
}

/**
 * Drag one edge of a room in or out by whole cells.
 *
 * Growing takes cells from whichever room is on the other side, which is what makes this the
 * same gesture as dragging the wall between them. Operates on the room's bounding box, so an
 * L-shaped room squares up along the edge being dragged.
 */
export function resizeRoom(
  level: Level,
  grid: Grid,
  roomId: string,
  edge: Edge,
  delta: number
): EditResult {
  const room = level.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Room not found." };
  if (delta === 0) return { ok: true, level };

  const box = boundingBox(room);
  const cells = roomCells(room);

  // Positive delta always means "grow", whichever edge is being dragged.
  const grow = delta > 0;
  const vertical = edge === "e" || edge === "w";

  // Clamp to the sheet when growing and to one remaining line when shrinking, rather than
  // refusing. Over-dragging should feel like the edge stopping, not like an error. The one
  // thing still worth refusing is covering another room entirely — that destroys data, so
  // fromOwnerMap says so out loud.
  const roomSpan = vertical ? box.w : box.h;
  const headroom = grow
    ? edge === "e"
      ? grid.w - (box.x + box.w)
      : edge === "w"
        ? box.x
        : edge === "s"
          ? grid.h - (box.y + box.h)
          : box.y
    : roomSpan - 1;

  const steps = Math.min(Math.abs(delta), Math.max(0, headroom));
  if (steps === 0) return { ok: true, level };

  for (let i = 0; i < steps; i++) {
    // Each step works on the line just beyond (grow) or just inside (shrink) the edge, walking
    // outward or inward as i advances.
    let line: number;
    switch (edge) {
      case "e":
        line = grow ? box.x + box.w + i : box.x + box.w - 1 - i;
        break;
      case "w":
        line = grow ? box.x - 1 - i : box.x + i;
        break;
      case "s":
        line = grow ? box.y + box.h + i : box.y + box.h - 1 - i;
        break;
      default:
        line = grow ? box.y - 1 - i : box.y + i;
    }

    const from = vertical ? box.y : box.x;
    const to = vertical ? box.y + box.h : box.x + box.w;
    for (let n = from; n < to; n++) {
      const k = vertical ? key(line, n) : key(n, line);
      if (grow) cells.add(k);
      else cells.delete(k);
    }
  }

  if (cells.size === 0) return { ok: false, error: "A room cannot be shrunk away entirely." };

  const map = ownerMap(level.rooms);
  for (const k of roomCells(room)) map.delete(k);
  for (const k of cells) map.set(k, roomId);
  return fromOwnerMap(level, grid, map);
}

let doorSeq = 0;

/** Rooms that share enough wall to hang a door between them. */
export function doorCandidates(level: Level, roomId: string): Array<{ id: string; label: string }> {
  const room = level.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  const mine = roomCells(room);
  const map = ownerMap(level.rooms);

  const touching = new Set<string>();
  let external = false;
  for (const k of mine) {
    const [x, y] = k.split(",").map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const neighbour = key(x + dx, y + dy);
      if (mine.has(neighbour)) continue;
      const other = map.get(neighbour);
      if (other) touching.add(other);
      else external = true;
    }
  }

  const out = level.rooms
    .filter((r) => touching.has(r.id))
    .map((r) => ({ id: r.id, label: r.label || "Unnamed" }));
  if (external) out.push({ id: OUTSIDE, label: "Outside" });
  return out;
}

export function addDoor(level: Level, a: string, b: string): EditResult {
  if (a === b) return { ok: false, error: "A door needs two different sides." };
  const exists = level.doors.some(
    (d) => (d.a === a && d.b === b) || (d.a === b && d.b === a)
  );
  if (exists) return { ok: false, error: "There is already a door between those two." };

  const door: Door = {
    id: `door-${Date.now().toString(36)}-${doorSeq++}`,
    a,
    b,
    kind: "swing",
    // External doors swing in; anything else opens into the second room until flipped.
    swingInto: b === OUTSIDE ? "a" : "b",
    hinge: "start",
    // Added by hand, so it is a decision rather than a guess — not dashed.
    confidence: "visible",
  };
  return { ok: true, level: { ...level, doors: [...level.doors, door] } };
}

export function updateDoor(level: Level, doorId: string, patch: Partial<Door>): EditResult {
  const idx = level.doors.findIndex((d) => d.id === doorId);
  if (idx === -1) return { ok: false, error: "Door not found." };
  const doors = [...level.doors];
  doors[idx] = { ...doors[idx], ...patch };
  return { ok: true, level: { ...level, doors } };
}

export function deleteDoor(level: Level, doorId: string): EditResult {
  return { ok: true, level: { ...level, doors: level.doors.filter((d) => d.id !== doorId) } };
}

export function renameRoom(level: Level, roomId: string, label: string): EditResult {
  return {
    ok: true,
    level: {
      ...level,
      rooms: level.rooms.map((r) => (r.id === roomId ? { ...r, label } : r)),
    },
  };
}

/**
 * Delete a room, leaving its cells unowned.
 *
 * The hole is deliberately NOT repaired: removing a room usually means it was never there,
 * so the space should read as outside the building rather than being quietly annexed by
 * whichever neighbour happened to touch it most.
 */
export function deleteRoom(level: Level, roomId: string): EditResult {
  if (level.rooms.length <= 1) return { ok: false, error: "A level needs at least one room." };
  return {
    ok: true,
    level: {
      ...level,
      rooms: level.rooms.filter((r) => r.id !== roomId),
      doors: level.doors.filter((d) => d.a !== roomId && d.b !== roomId),
      annotations: level.annotations.filter(
        (an) => an.anchor.type !== "room" || an.anchor.roomId !== roomId
      ),
    },
  };
}
