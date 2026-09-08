// Site Snap — balance and geometry check. Pure: no env, no network, no database.
//
//   npx tsx scripts/check-site-snap.ts
//
// This is the script that earns its keep. It drives the real engine with no canvas, so it
// answers the questions you cannot answer by looking at the game:
//
//   1. Is the house actually completable — every room reachable, every centre walkable?
//   2. Can the player clip through a wall at full speed?
//   3. IS THE OPTIMUM INTERIOR? A run where "rush everything" or "perfect everything" wins
//      outright is a leaderboard that measures nothing. This is the same failure that made
//      the first Pong build unloseable, caught the same way.
//
// Exits non-zero on any assertion failure, so it can gate a commit.

import {
  GRID,
  ROOMS,
  SOLID,
  SPAWN,
  TOTAL_WALLS,
  isSolid,
  roomAt,
  type Side,
} from "@/components/tools/site-snap/house";
import {
  RUN_SECONDS,
  newGame,
  step,
  summarise,
  type GameState,
} from "@/components/tools/site-snap/engine";

const DT = 1 / 60;

// ── Deterministic RNG so a failure is reproducible ──────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Pathfinding, so the bot walks like a person and not through walls ───
type Cell = { x: number; y: number };

function bfs(from: Cell, to: Cell): Cell[] | null {
  const key = (c: Cell) => c.y * GRID.w + c.x;
  const prev = new Map<number, number>();
  const seen = new Set<number>([key(from)]);
  const queue: Cell[] = [from];

  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.x === to.x && cur.y === to.y) {
      const path: Cell[] = [];
      let k: number | undefined = key(cur);
      while (k !== undefined) {
        path.push({ x: k % GRID.w, y: Math.floor(k / GRID.w) });
        k = prev.get(k);
      }
      return path.reverse();
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID.w || ny >= GRID.h) continue;
      if (SOLID[ny][nx]) continue;
      const nk = ny * GRID.w + nx;
      if (seen.has(nk)) continue;
      seen.add(nk);
      prev.set(nk, key(cur));
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

// ── Geometry assertions ─────────────────────────────────────────────────
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
}

console.log("\nGeometry");

const spawnCell = { x: Math.floor(SPAWN.x), y: Math.floor(SPAWN.y) };
check("spawn is walkable", !isSolid(spawnCell.x, spawnCell.y));

for (const r of ROOMS) {
  const centre = { x: Math.floor(r.cx), y: Math.floor(r.cy) };
  const walkable = !isSolid(centre.x, centre.y);
  const inRoom = roomAt(r.cx, r.cy) === r.id;
  const reachable = walkable && bfs(spawnCell, centre) !== null;
  check(
    `${r.label.padEnd(12)} centre walkable, in-room and reachable`,
    walkable && inRoom && reachable,
    `walkable=${walkable} inRoom=${inRoom} reachable=${reachable}`
  );
}

// Derived, not a magic number: the count changes legitimately whenever a room is added, and
// an assertion that has to be hand-edited after every layout change is one that gets muted.
check(
  `${TOTAL_WALLS} capture targets = ${ROOMS.length} rooms x 4`,
  TOTAL_WALLS === ROOMS.length * 4,
  `got ${TOTAL_WALLS} for ${ROOMS.length} rooms`
);
check("the run finishes outdoors", ROOMS.some((r) => r.kind === "outdoor"));

// ── The bot ─────────────────────────────────────────────────────────────

const SIDE_INPUT: Record<Side, "up" | "down" | "left" | "right"> = {
  n: "up",
  s: "down",
  w: "left",
  e: "right",
};

function clearInput(s: GameState): void {
  s.input.up = false;
  s.input.down = false;
  s.input.left = false;
  s.input.right = false;
  s.input.shutter = false;
}

/**
 * Is the cat close enough that bracing any longer is wasted time?
 *
 * There is deliberately no toddler equivalent. The obvious one — stop walking when a toddler
 * is underfoot, since a trip needs a moving player — DEADLOCKS: they home on you, so the
 * moment you stop they close in and you never move again. Every bot given that rule froze in
 * the hallway and finished with a score around 500 against 3450 for one that simply walked
 * on and ate the occasional trip. The real counter is to steer around them, which is a
 * player's job, not something this bot needs to model to answer the balance question.
 */
function catClosing(state: GameState): boolean {
  return Math.hypot(state.cat.x - state.x, state.cat.y - state.y) < 1.8;
}

type BotOpts = {
  /** Seconds to brace before firing. Expressed as TIME, not as a focus threshold: focus
   *  approaches 1 asymptotically and never reaches it, so "wait for focus >= 1" is a bot that
   *  stands still until the clock runs out. A person waits a beat, not a number. */
  patience: number;
  /** Seconds to brace on a wall showing a defect (worth double). */
  defectPatience: number;
  /** How sloppily the bot parks, in tiles of offset from the room centre. */
  sloppiness: number;
  /** Takes the shot early when the cat closes in, rather than bracing for one it is about
   *  to ruin. A player learns this within two runs. */
  catAware: boolean;
  rand: () => number;
};

type RunResult = ReturnType<typeof summarise> & { stuck: boolean; clipped: boolean };

function playRun(opts: BotOpts): RunResult {
  const state = newGame(opts.rand);
  let clipped = false;
  let stuck = false;

  // Greedy nearest-unvisited route, which is roughly what a person does.
  const remaining = new Set(ROOMS.map((r) => r.id));
  let guard = 0;

  const advance = (steps = 1) => {
    for (let i = 0; i < steps; i++) {
      if (state.done) return;
      step(state, DT, opts.rand);
      if (isSolid(Math.floor(state.x), Math.floor(state.y))) clipped = true;
      guard++;
      if (guard > 60 * (RUN_SECONDS + 5)) stuck = true;
    }
  };

  while (remaining.size > 0 && !state.done && !stuck) {
    const here = { x: Math.floor(state.x), y: Math.floor(state.y) };
    let best: { id: string; path: Cell[] } | null = null;
    for (const id of remaining) {
      const r = ROOMS.find((rr) => rr.id === id)!;
      const path = bfs(here, { x: Math.floor(r.cx), y: Math.floor(r.cy) });
      if (path && (!best || path.length < best.path.length)) best = { id, path };
    }
    if (!best) break;
    remaining.delete(best.id);
    const target = ROOMS.find((r) => r.id === best!.id)!;

    // Walk the path.
    for (const cell of best.path) {
      const tx = cell.x + 0.5;
      const ty = cell.y + 0.5;
      let hops = 0;
      while (!state.done && !stuck && Math.hypot(state.x - tx, state.y - ty) > 0.2) {
        clearInput(state);
        if (state.x < tx - 0.1) state.input.right = true;
        else if (state.x > tx + 0.1) state.input.left = true;
        if (state.y < ty - 0.1) state.input.down = true;
        else if (state.y > ty + 0.1) state.input.up = true;
        advance();
        if (++hops > 400) break; // wedged on geometry — let the guard catch it
      }
    }

    // Park near the centre, offset by however sloppy this bot is.
    const ox = (opts.rand() * 2 - 1) * opts.sloppiness;
    const oy = (opts.rand() * 2 - 1) * opts.sloppiness;
    const px = target.cx + ox;
    const py = target.cy + oy;
    let settle = 0;
    while (!state.done && !stuck && Math.hypot(state.x - px, state.y - py) > 0.12 && settle < 300) {
      clearInput(state);
      if (state.x < px - 0.05) state.input.right = true;
      else if (state.x > px + 0.05) state.input.left = true;
      if (state.y < py - 0.05) state.input.down = true;
      else if (state.y > py + 0.05) state.input.up = true;
      advance();
      settle++;
    }
    clearInput(state);
    // One idle step so speed drops to zero before pivoting. Without it the bot is still
    // moving when it taps a direction, so the turn-in-place branch doesn't fire, it WALKS
    // instead, and it slowly drifts off the centre until shots start getting refused.
    advance();

    // Shoot all four walls from here.
    for (const side of ["n", "e", "s", "w"] as Side[]) {
      if (state.done || stuck) break;

      // Pulse the direction for one step to pivot without walking.
      clearInput(state);
      if (state.facing !== side) {
        state.input[SIDE_INPUT[side]] = true;
        advance();
        clearInput(state);
        while (!state.done && state.turnLock > 0) advance();
      }

      const wallId = `${target.id}:${side}`;
      const braceFor = state.defects.has(wallId) ? opts.defectPatience : opts.patience;

      // Retry a refused shot. The cat wandering into frame is the only thing that refuses a
      // shot taken from the right place, and a person would obviously wait a beat and go
      // again rather than leave a hole in the report. A bot that fires once and walks off
      // made every strategy look incomplete and buried the real balance signal.
      for (let attempt = 0; attempt < 4; attempt++) {
        if (state.done || stuck) break;

        let waited = 0;
        const braceSteps = Math.round(braceFor / DT);
        while (
          !state.done &&
          !stuck &&
          (waited < braceSteps || state.shutterCooldown > 0 || state.stun > 0) &&
          waited < 400
        ) {
          // The cat is on its way and will zero the focus meter the moment it arrives.
          // Taking a mediocre shot now beats bracing for one that never happens.
          if (opts.catAware && catClosing(state) && state.shutterCooldown <= 0 && state.stun <= 0) break;
          advance();
          waited++;
        }

        state.input.shutter = true;
        advance();
        state.input.shutter = false;
        advance();

        if (state.captured[wallId] !== undefined) break;
        // Refused — let the cat move on before trying again.
        for (let i = 0; i < 20 && !state.done && !stuck; i++) advance();
      }
    }
  }

  // Let the clock run out if the survey finished early — the bonus is already banked by then.
  return { ...summarise(state), stuck, clipped };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function trials(label: string, opts: Omit<BotOpts, "rand">, n = 15) {
  const runs: RunResult[] = [];
  for (let i = 0; i < n; i++) runs.push(playRun({ ...opts, rand: mulberry32(1000 + i) }));

  const score = median(runs.map((r) => r.score));
  const time = median(runs.map((r) => r.elapsed));
  const quality = median(runs.map((r) => r.avgQuality));
  const complete = runs.filter((r) => r.complete).length;
  const clipped = runs.some((r) => r.clipped);
  const stuck = runs.some((r) => r.stuck);

  const tangles = median(runs.map((r) => r.tangles));
  const trips = median(runs.map((r) => r.trips));

  console.log(
    `  ${label.padEnd(26)} score=${String(score).padStart(5)}  ` +
      `time=${time.toFixed(1).padStart(5)}s  q=${quality.toFixed(0).padStart(3)}  ` +
      `cat=${String(tangles).padStart(2)} trip=${String(trips).padStart(2)}  ` +
      `complete=${complete}/${n}${clipped ? "  CLIPPED" : ""}${stuck ? "  STUCK" : ""}`
  );

  return { label, score, time, quality, complete, n, clipped, stuck, tangles, trips };
}

console.log("\nStrategies");
const results = [
  trials("rush everything", { patience: 0, defectPatience: 0, sloppiness: 0.35, catAware: true }),
  trials("rush, care on defects", { patience: 0, defectPatience: 0.8, sloppiness: 0.3, catAware: true }),
  trials("balanced", { patience: 0.35, defectPatience: 0.8, sloppiness: 0.25, catAware: true }),
  trials("careful", { patience: 0.8, defectPatience: 1.2, sloppiness: 0.2, catAware: true }),
  trials("perfectionist", { patience: 1.8, defectPatience: 1.8, sloppiness: 0.1, catAware: true }),
  trials("sloppy parking", { patience: 0.4, defectPatience: 0.8, sloppiness: 1.5, catAware: true }),
  trials("ignores the cat", { patience: 0.8, defectPatience: 1.2, sloppiness: 0.2, catAware: false }),
];

console.log("\nAssertions");

const clipped = results.some((r) => r.clipped);
check("player never clips into a wall", !clipped);

const stuck = results.some((r) => r.stuck);
check("no strategy gets stuck", !stuck);

const finishers = results.filter((r) => r.complete === r.n);
check("every sane strategy finishes in time", finishers.length >= 5, `${finishers.length}/6`);

const rush = results[0];
const perfect = results[4];
const best = results.reduce((a, b) => (b.score > a.score ? b : a));

check(
  "best strategy is neither extreme",
  best !== rush && best !== perfect,
  `best = "${best.label}"`
);

const margin = (other: { score: number }) => (1 - other.score / best.score) * 100;
console.log(
  `\n  best: "${best.label}" ${best.score}` +
    `  ·  rush is ${margin(rush).toFixed(0)}% below` +
    `  ·  perfectionist is ${margin(perfect).toFixed(0)}% below`
);

check("rushing loses by >= 10%", margin(rush) >= 10, `${margin(rush).toFixed(0)}%`);
check("perfectionism loses by >= 10%", margin(perfect) >= 10, `${margin(perfect).toFixed(0)}%`);

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed.\n`);
  process.exit(1);
}
console.log("\nAll checks passed.\n");
