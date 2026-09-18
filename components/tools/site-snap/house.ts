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
/**
 * 36 wide is a ceiling, not a preference: the tool column is ~1176px, so a canvas wider than
 * 588 logical pixels can no longer be scaled by a whole factor of 2 and drops to 1x. Every
 * column added to the layout has to come out of another.
 *
 * There is a one-cell margin of open ground all round, so the house sits on a lawn instead of
 * being framed by its own outer wall.
 */
export const GRID = { w: 36, h: 21 } as const;

export type Side = "n" | "e" | "s" | "w";
export const SIDES: Side[] = ["n", "e", "s", "w"];

/** An outdoor area is bounded by fences, not walls — it draws and reads differently. */
export type RoomKind = "room" | "outdoor";

type RoomDef = {
  id: string;
  label: string;
  kind: RoomKind;
  /** Interior cells: x..x+w-1, y..y+h-1. Everything unclaimed is wall. */
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * A more house-shaped plan than the first pass, which was three equal boxes over two equal
 * boxes and read as a spreadsheet. Rooms now vary the way real ones do — a small bathroom
 * off the hall, a big living room opening onto the yard, a kitchen that isn't the same size
 * as anything else — and the run finishes outside.
 *
 * The BACKYARD is a genuine capture target, not scenery. Photographing boundary fences and
 * external elevations is a real part of a dilapidation survey, so the last four shots of a
 * run being outdoors is the most true-to-life thing in the game.
 */
const ROOM_DEFS: RoomDef[] = [
  { id: "bed1", label: "Bedroom 1", kind: "room", x: 2, y: 2, w: 8, h: 6 },
  { id: "bath", label: "Bathroom", kind: "room", x: 11, y: 2, w: 5, h: 6 },
  { id: "bed2", label: "Bedroom 2", kind: "room", x: 17, y: 2, w: 8, h: 6 },
  { id: "hall", label: "Hallway", kind: "room", x: 2, y: 9, w: 23, h: 3 },
  { id: "kitchen", label: "Kitchen", kind: "room", x: 2, y: 13, w: 9, h: 6 },
  { id: "living", label: "Living Room", kind: "room", x: 12, y: 13, w: 13, h: 6 },
  { id: "yard", label: "Backyard", kind: "outdoor", x: 27, y: 4, w: 7, h: 13 },
];

/**
 * Wall cells carved back out into doorways. TWO tiles wide, not one: the player box is 0.6
 * tiles, and a one-tile opening leaves 0.2 of clearance either side — passable, but it feels
 * like threading a needle and players blame the game rather than themselves.
 *
 * The back door needs FOUR cells because the house's east wall (x=26) and the yard fence
 * (x=27) are adjacent columns, so the opening has to pass through both.
 */
const DOORWAYS: Array<{ x: number; y: number }> = [
  { x: 5, y: 8 },
  { x: 6, y: 8 }, // bed1 -> hall
  { x: 13, y: 8 },
  { x: 14, y: 8 }, // bath -> hall
  { x: 20, y: 8 },
  { x: 21, y: 8 }, // bed2 -> hall
  { x: 5, y: 12 },
  { x: 6, y: 12 }, // kitchen -> hall
  { x: 18, y: 12 },
  { x: 19, y: 12 }, // living -> hall
  { x: 25, y: 14 },
  { x: 26, y: 14 },
  { x: 25, y: 15 },
  { x: 26, y: 15 }, // living -> backyard
];

export type Room = {
  id: string;
  label: string;
  kind: RoomKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Continuous centre of the interior, in tile units.
   *
   * NOT where you shoot from any more — that is STAND_POINTS, one per wall. This is still a
   * useful handle on "the room" for routing and for framing, so it stays; it just stopped
   * being a rule.
   */
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

/**
 * Is this solid cell actual built structure, or just open ground beyond the property?
 *
 * Everything unclaimed by a room is SOLID, which is right for collision and wrong for
 * drawing: without this the one-cell margin around the layout renders as cream wall and the
 * house looks embedded in a giant block rather than sitting on a lawn.
 */
export function isStructural(cx: number, cy: number): boolean {
  if (!isSolid(cx, cy)) return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= GRID.w || y >= GRID.h) continue;
      if (OWNER[y][x] !== null) return true;
    }
  }
  return false;
}

/** Is this wall cell part of the yard's boundary rather than the building? */
export function isFenceCell(cx: number, cy: number): boolean {
  const yard = room("yard");
  return (
    cx >= yard.x - 1 &&
    cx <= yard.x + yard.w &&
    cy >= yard.y - 1 &&
    cy <= yard.y + yard.h &&
    isSolid(cx, cy)
  );
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

// ── Where you stand to photograph a wall ────────────────────────────────
//
// The rule this replaced was "stand on the crosshair in the middle of the room". That is not
// what an inspector does, and mechanically it collapsed 28 captures into 7 decisions: once you
// had walked to the centre, all four walls were four key presses from the same spot.
//
// You now shoot each wall from in FRONT of it — roughly on its midline, and at a standoff that
// is neither too close nor too far. The standoff is not a hand-picked constant per wall. It
// falls out of the camera:
//
//   the cone of a FOV_HALF_ANGLE lens is exactly `length` wide at `length/2 / tan(FOV_HALF)`
//
// so the ideal distance is the one where the wall exactly fills the frame. That is what makes
// the field-of-view cone the renderer draws a genuine READOUT rather than an ornament: when the
// cone's edges land on the wall's corners, you are standing in the right place. There is no
// second set of numbers for the player to learn.
//
// 50° is a wide-angle lens, which is what building inspectors actually carry — and it is also
// the value that makes every wall in this house reachable. Narrower, and the ideal standoff for
// a long wall falls outside the room it is in.

/** Half-angle of the camera's field of view. The whole standoff model hangs off this. */
export const FOV_HALF_ANGLE = (50 * Math.PI) / 180;
export const FOV_TAN = Math.tan(FOV_HALF_ANGLE);

/** Never stand closer than this, however short the wall. Binds on nothing in this house; it is
 *  here so house #2 cannot produce a zero standoff. */
const MIN_STANDOFF = 1.2;
/**
 * Keep the stand point this far off the wall BEHIND you.
 *
 * ⚠️ Must exceed the player's half-width (0.3) or the point is physically unreachable — and an
 * unreachable stand point fails silently: the bot's settle loop spins out and then shoots from
 * wherever it stalled, producing a plausible-looking score. checkStandPoints() asserts it.
 */
const STANDOFF_MARGIN = 0.8;
/** How far past the frame edge you can drift sideways before the shot is worth nothing. */
const LATERAL_PAD = 1.5;

export type WallShot = {
  /** Midpoint of the wall face, in tile units — where the cone should be centred. */
  mx: number;
  my: number;
  /** The axis you slide along to stay in front of this wall. */
  axis: "x" | "y";
  /** Length of the wall face. */
  length: number;
  /** Ideal perpendicular standoff, and the stand point that follows from it. */
  ideal: number;
  sx: number;
  sy: number;
  /**
   * Distance off the midline at which the shot scores zero.
   *
   * ⚠️ Derived from what the CAMERA covers (`ideal * FOV_TAN`), NOT from the wall's length. For
   * every wall whose ideal standoff is not clamped the two are identical, so this is a no-op on
   * 24 of the 28. It matters for the hall: its 23-tile walls clamp to a 2.2 standoff, and on
   * wall length they would be shootable from 98% of the corridor — you could photograph the
   * north wall from the far west end and score full marks. On frame width it is 31%.
   */
  lateralZero: number;
};

function buildWallShot(r: Room, side: Side): WallShot {
  const alongX = side === "n" || side === "s";
  const length = alongX ? r.w : r.h;
  const depth = alongX ? r.h : r.w;

  // Math.max(lo, Math.min(hi, v)) returns `lo` when lo > hi, i.e. a standoff OUTSIDE the room.
  // Safe in this house (min depth 3, so hi = 2.2 > lo = 1.2) and asserted by the check script.
  const ideal = Math.max(MIN_STANDOFF, Math.min(length / 2 / FOV_TAN, depth - STANDOFF_MARGIN));

  const mx = alongX ? r.x + r.w / 2 : side === "w" ? r.x : r.x + r.w;
  const my = alongX ? (side === "n" ? r.y : r.y + r.h) : r.y + r.h / 2;

  return {
    mx,
    my,
    axis: alongX ? "x" : "y",
    length,
    ideal,
    sx: alongX ? mx : side === "w" ? mx + ideal : mx - ideal,
    sy: alongX ? (side === "n" ? my + ideal : my - ideal) : my,
    lateralZero: ideal * FOV_TAN + LATERAL_PAD,
  };
}

/**
 * Every wall's shot geometry, keyed exactly like WALLS (`${roomId}:${side}`).
 *
 * ONE definition with three consumers — the engine scores against it, the renderer draws the
 * cone and the lit wall slice from it, and the balance harness routes to it. Three separate
 * re-derivations of the clamp above is precisely how a harness and the game it is meant to
 * measure drift apart.
 */
export const STAND_POINTS: Record<string, WallShot> = Object.fromEntries(
  WALLS.map((w) => [w.id, buildWallShot(room(w.roomId), w.side)])
);

export function standPoint(roomId: string, side: Side): WallShot {
  const found = STAND_POINTS[`${roomId}:${side}`];
  if (!found) throw new Error(`Unknown wall: ${roomId}:${side}`);
  return found;
}

/**
 * Where a point stands relative to a wall: how far back, and how far off its midline.
 *
 * Pure geometry, no scoring — the curve that turns these into a quality factor lives in
 * engine.ts, because that is a balance decision and this is not.
 */
export function shotGeometry(
  roomId: string,
  side: Side,
  x: number,
  y: number
): { standoff: number; lateral: number } {
  const s = standPoint(roomId, side);
  if (s.axis === "x") {
    return { standoff: Math.abs(y - s.my), lateral: x - s.mx };
  }
  return { standoff: Math.abs(x - s.mx), lateral: y - s.my };
}

/** Where the player starts — the middle of the hall. */
export const SPAWN = { x: 13.5, y: 10.5 } as const;

/** Every walkable cell, for retreat targets and the sim's reachability check. */
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
 * Breadth-first over the grid — trivial to run, but the chasers still only re-plan a few
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
