// Site Snap — the house.
//
// One fixed layout, authored by hand. Everyone runs the same course, so scores are directly
// comparable and learning the route is part of the skill. The shape below is data, so a
// second house is a new object rather than a refactor.
//
// WALLS OCCUPY CELLS. The alternative — rooms touching, with walls living on the line
// between two cells, which is how lib/floor-plan models them — makes collision a set of thin
// line segments and a doorway a gap in a segment. Giving a wall its own cell costs a tile of
// space and turns both problems into `solid[y][x]`.
//
// Deliberately NOT importing buildOwnerGrid from lib/floor-plan/grid.ts, despite it doing
// exactly this job. That module value-imports ./types, which pulls **zod** in with it, and
// this is a lazily-loaded game chunk. It is five lines of loop to do here. The room shape is
// kept structurally identical to floor-plan's `Rect` on purpose, so "walk the house you
// surveyed last week" stays a small adapter rather than a rewrite.

/** Logical pixels per tile. The canvas is GRID.w x GRID.h tiles at this size. */
export const TILE = 16;
export const GRID = { w: 32, h: 18 } as const;

export type Side = "n" | "e" | "s" | "w";
export const SIDES: Side[] = ["n", "e", "s", "w"];

type RoomDef = {
  id: string;
  label: string;
  /** Interior cells: x..x+w-1, y..y+h-1. Everything unclaimed is wall. */
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * Six rooms hung off a central hall. Every room is a spur off the spine, so the order you
 * visit them in genuinely matters — that routing decision is most of the game.
 *
 * Sizes vary deliberately. The living room is forgiving and the bathroom is tight, so the
 * 24 shots don't all feel like the same shot.
 */
const ROOM_DEFS: RoomDef[] = [
  { id: "bed1", label: "Bedroom 1", x: 1, y: 1, w: 10, h: 6 },
  { id: "bath", label: "Bathroom", x: 12, y: 1, w: 7, h: 6 },
  { id: "bed2", label: "Bedroom 2", x: 20, y: 1, w: 11, h: 6 },
  { id: "hall", label: "Hallway", x: 1, y: 8, w: 30, h: 3 },
  { id: "kitchen", label: "Kitchen", x: 1, y: 12, w: 13, h: 5 },
  { id: "living", label: "Living Room", x: 15, y: 12, w: 16, h: 5 },
];

/**
 * Wall cells carved back out into doorways. TWO tiles wide, not one: the player box is 0.6
 * tiles, and a one-tile opening leaves 0.2 of clearance either side — passable, but it feels
 * like threading a needle and players blame the game rather than themselves. Nobody ever
 * notices a generous doorway.
 */
const DOORWAYS: Array<{ x: number; y: number }> = [
  { x: 5, y: 7 },
  { x: 6, y: 7 }, // bed1 -> hall
  { x: 15, y: 7 },
  { x: 16, y: 7 }, // bath -> hall
  { x: 25, y: 7 },
  { x: 26, y: 7 }, // bed2 -> hall
  { x: 6, y: 11 },
  { x: 7, y: 11 }, // kitchen -> hall
  { x: 22, y: 11 },
  { x: 23, y: 11 }, // living -> hall
];

export type Room = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Continuous centre of the interior, in tile units — the spot you must shoot from. */
  cx: number;
  cy: number;
};

export const ROOMS: Room[] = ROOM_DEFS.map((r) => ({
  ...r,
  cx: r.x + r.w / 2,
  cy: r.y + r.h / 2,
}));

const ROOM_BY_ID = new Map(ROOMS.map((r) => [r.id, r]));

export function room(id: string): Room {
  const found = ROOM_BY_ID.get(id);
  if (!found) throw new Error(`Unknown room: ${id}`);
  return found;
}

/** Cell ownership. null = wall or doorway, i.e. not inside any room. */
export const OWNER: Array<Array<string | null>> = Array.from({ length: GRID.h }, () =>
  Array<string | null>(GRID.w).fill(null)
);
for (const r of ROOM_DEFS) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) OWNER[y][x] = r.id;
  }
}

const DOOR_KEYS = new Set(DOORWAYS.map((d) => `${d.x},${d.y}`));

/** True where the player cannot walk. Doorways are punched back through. */
export const SOLID: boolean[][] = Array.from({ length: GRID.h }, (_, y) =>
  Array.from({ length: GRID.w }, (_, x) => OWNER[y][x] === null && !DOOR_KEYS.has(`${x},${y}`))
);

export function isSolid(cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= GRID.w || cy >= GRID.h) return true;
  return SOLID[cy][cx];
}

/** Which room a continuous tile-space point is in, or null in a doorway or a wall. */
export function roomAt(x: number, y: number): string | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= GRID.w || cy >= GRID.h) return null;
  return OWNER[cy][cx];
}

export function isDoorway(cx: number, cy: number): boolean {
  return DOOR_KEYS.has(`${cx},${cy}`);
}

export type Wall = {
  /** `${roomId}:${side}` — stable, and readable in a debug dump. */
  id: string;
  roomId: string;
  side: Side;
};

/** Every capture target: four per room. Each room photographs its OWN side of a shared
 *  partition, which is both mechanically necessary and how a real survey works — the kitchen
 *  face and the hall face of one wall are different surfaces with different defects. */
export const WALLS: Wall[] = ROOMS.flatMap((r) =>
  SIDES.map((side) => ({ id: `${r.id}:${side}`, roomId: r.id, side }))
);

export const TOTAL_WALLS = WALLS.length;

/** Where the player starts — the middle of the hall. */
export const SPAWN = { x: 16, y: 9.5 } as const;

/** Every walkable cell, for the cat's wander target and the sim's reachability check. */
export function walkableCells(): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < GRID.h; y++) {
    for (let x = 0; x < GRID.w; x++) if (!SOLID[y][x]) out.push({ x, y });
  }
  return out;
}

/** A grid cell. */
export type Cell = { x: number; y: number };

/**
 * Shortest walkable path between two cells, as a list of cells including both ends.
 * Returns null if there is no route (which the level checks say cannot happen).
 *
 * Breadth-first over 576 cells — trivial to run, but the chasers still only re-plan a few
 * times a second rather than every frame. The alternative, homing straight at the player and
 * sliding along whatever it hits, leaves a cat wedged against a bedroom wall while the player
 * works two rooms away: a hazard that cannot reach you is just scenery.
 */
export function pathCells(from: Cell, to: Cell): Cell[] | null {
  if (from.x === to.x && from.y === to.y) return [from];
  if (isSolid(to.x, to.y) || isSolid(from.x, from.y)) return null;

  const key = (x: number, y: number) => y * GRID.w + x;
  const prev = new Int32Array(GRID.w * GRID.h).fill(-1);
  const seen = new Uint8Array(GRID.w * GRID.h);
  const queue: number[] = [key(from.x, from.y)];
  seen[key(from.x, from.y)] = 1;
  const goal = key(to.x, to.y);

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur === goal) {
      const path: Cell[] = [];
      let k = cur;
      while (k !== -1) {
        path.push({ x: k % GRID.w, y: Math.floor(k / GRID.w) });
        k = prev[k];
      }
      return path.reverse();
    }
    const cx = cur % GRID.w;
    const cy = Math.floor(cur / GRID.w);
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID.w || ny >= GRID.h) continue;
      if (SOLID[ny][nx]) continue;
      const nk = key(nx, ny);
      if (seen[nk]) continue;
      seen[nk] = 1;
      prev[nk] = cur;
      queue.push(nk);
    }
  }
  return null;
}

const NEIGHBOURS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
