/**
 * CrackBlast rules — pure, DOM-free, so the scores route can import the scoring ceilings
 * without pulling the game in. Ported from the CrackBlast v2.0 design build (the
 * "CrackBlast Prompt.md" spec).
 */

export type Shape = readonly (readonly [number, number])[];

/** The board is fixed at 8x8 here: the 10x10 option is an easier game, and one staff-wide
 *  leaderboard only means something if everyone plays the same board. */
export const N = 8;

export const SHAPES: Shape[] = [
  [[0, 0]],
  [[0, 0], [0, 1]], [[0, 0], [1, 0]],
  [[0, 0], [0, 1], [0, 2]], [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [0, 1], [0, 2], [0, 3]], [[0, 0], [1, 0], [2, 0], [3, 0]],
  [[0, 0], [0, 1], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]], [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]],
  [[0, 0], [1, 0], [1, 1]], [[0, 1], [1, 0], [1, 1]], [[0, 0], [0, 1], [1, 0]], [[0, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [2, 1]], [[0, 1], [1, 1], [2, 1], [2, 0]], [[0, 0], [0, 1], [0, 2], [1, 0]], [[0, 0], [0, 1], [0, 2], [1, 2]],
  [[0, 0], [0, 1], [0, 2], [1, 1]], [[0, 1], [1, 0], [1, 1], [1, 2]],
  [[0, 1], [0, 2], [1, 0], [1, 1]], [[0, 0], [0, 1], [1, 1], [1, 2]],
  [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]],
  [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
];

// ── Scoring ──────────────────────────────────────────────────────────────

export const POINTS_PER_CELL = 2;
export const COMBO_GRACE = 3;

export function comboMultiplier(combo: number): number {
  return Math.min(4, 1 + 0.5 * (combo - 1));
}

export function clearPoints(lines: number, combo: number): number {
  return lines ? Math.round(50 * lines * lines * comboMultiplier(combo)) : 0;
}

/** Ceilings the scores route checks a submitted run against. The biggest piece is 9 cells;
 *  the most lines one drop can finish on 8x8 is 6 (a 3x3 or a 1x5), which at the 4x cap is
 *  50 x 36 x 4 / 6 = 1,200 points a line. */
export const MAX_POINTS_PER_MOVE = POINTS_PER_CELL * 9;
export const MAX_POINTS_PER_LINE = 1200;

// ── Board ────────────────────────────────────────────────────────────────

/** Board cells hold a block colour index, or null when empty. */
export type Grid = (number | null)[];

export type Piece = { shape: Shape; w: number; h: number; color: number; id: number };

export type Line = { type: "row" | "col"; cells: number[] };

export function fits(g: Grid, sh: Shape, r: number, c: number): boolean {
  for (const [a, b] of sh) {
    const rr = r + a, cc = c + b;
    if (rr < 0 || cc < 0 || rr >= N || cc >= N || g[rr * N + cc] != null) return false;
  }
  return true;
}

export function fitsAny(g: Grid, sh: Shape): boolean {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (fits(g, sh, r, c)) return true;
  return false;
}

export function findLines(g: Grid): Line[] {
  const L: Line[] = [];
  for (let r = 0; r < N; r++) {
    const cells: number[] = [];
    let full = true;
    for (let c = 0; c < N; c++) {
      if (g[r * N + c] == null) { full = false; break; }
      cells.push(r * N + c);
    }
    if (full) L.push({ type: "row", cells });
  }
  for (let c = 0; c < N; c++) {
    const cells: number[] = [];
    let full = true;
    for (let r = 0; r < N; r++) {
      if (g[r * N + c] == null) { full = false; break; }
      cells.push(r * N + c);
    }
    if (full) L.push({ type: "col", cells });
  }
  return L;
}

// ── Dealing (every set of three is placeable in at least one order) ─────────

function mkPiece(sh: Shape): Piece {
  return {
    shape: sh,
    w: Math.max(...sh.map((p) => p[1])) + 1,
    h: Math.max(...sh.map((p) => p[0])) + 1,
    color: Math.floor(Math.random() * 5),
    id: Math.random(),
  };
}

function weight(sh: Shape): number {
  const n = sh.length;
  return n === 1 ? 0.25 : n === 2 ? 0.6 : Math.pow(n, 1.35);
}

function pick(pool: Shape[]): Shape {
  const tot = pool.reduce((s, sh) => s + weight(sh), 0);
  let x = Math.random() * tot;
  for (const sh of pool) {
    x -= weight(sh);
    if (x <= 0) return sh;
  }
  return pool[pool.length - 1];
}

type Bits = Uint8Array;

function bFits(g: Bits, sh: Shape, r: number, c: number): boolean {
  for (const [a, b] of sh) {
    const rr = r + a, cc = c + b;
    if (rr >= N || cc >= N || g[rr * N + cc]) return false;
  }
  return true;
}

function bSpots(g: Bits, sh: Shape): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (bFits(g, sh, r, c)) out.push([r, c]);
  return out;
}

function bPlace(g: Bits, sh: Shape, r: number, c: number): Bits {
  const h = g.slice();
  for (const [a, b] of sh) h[(r + a) * N + c + b] = 1;
  const kill: number[] = [];
  for (let i = 0; i < N; i++) {
    let row = true, col = true;
    for (let j = 0; j < N; j++) {
      if (!h[i * N + j]) row = false;
      if (!h[j * N + i]) col = false;
    }
    if (row) for (let j = 0; j < N; j++) kill.push(i * N + j);
    if (col) for (let j = 0; j < N; j++) kill.push(j * N + i);
  }
  for (const k of kill) h[k] = 0;
  return h;
}

/** true = confirmed solvable, false = confirmed not, null = gave up at the step cap. */
function solvable(g: Bits, shapes: Shape[]): boolean | null {
  let nodes = 0;
  const LIMIT = 30_000;
  const rec = (b: Bits, rem: Shape[]): boolean => {
    if (!rem.length) return true;
    const tried = new Set<Shape>();
    for (let j = 0; j < rem.length; j++) {
      if (tried.has(rem[j])) continue;
      tried.add(rem[j]);
      const rest = rem.filter((_, q) => q !== j);
      for (const [r, c] of bSpots(b, rem[j])) {
        if (++nodes > LIMIT) throw new Error("limit");
        if (rec(bPlace(b, rem[j], r, c), rest)) return true;
      }
    }
    return false;
  };
  try {
    return rec(g, shapes);
  } catch {
    return null;
  }
}

export function deal(grid: Grid): Piece[] {
  const pool = SHAPES.filter((s) => s.every(([a, b]) => a < N && b < N));
  const g = Uint8Array.from(grid, (v) => (v != null ? 1 : 0));
  for (let t = 0; t < 30; t++) {
    const set = [0, 1, 2].map(() => pick(pool));
    if (solvable(g, set) === true) return set.map(mkPiece);
  }
  // Rescue set: build one that is placeable move by move, then shuffle the order.
  let b: Bits = g;
  const set: Shape[] = [];
  for (let k = 0; k < 3; k++) {
    const fit = pool.filter((sh) => bSpots(b, sh).length);
    const sh = pick(fit.length ? fit : [SHAPES[0]]);
    const spots = bSpots(b, sh);
    if (spots.length) {
      const [r, c] = spots[Math.floor(Math.random() * spots.length)];
      b = bPlace(b, sh, r, c);
    }
    set.push(sh);
  }
  for (let i = set.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [set[i], set[j]] = [set[j], set[i]];
  }
  return set.map(mkPiece);
}
