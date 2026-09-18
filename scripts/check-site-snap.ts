// Site Snap — balance and geometry check. Pure: no env, no network, no database.
//
//   npx tsx scripts/check-site-snap.ts
//
// This is the script that earns its keep. It drives the real engine with no canvas, so it
// answers the questions you cannot answer by looking at the game:
//
//   1. Is the house actually completable — every STAND POINT reachable and legal?
//   2. Can the player clip through a wall at full speed?
//   3. Does the position model DISCRIMINATE? A sign error that made every spot in a room
//      score the same would leave every balance assertion below perfectly green.
//   4. IS THE OPTIMUM INTERIOR? A run where "rush everything" or "perfect everything" wins
//      outright is a leaderboard that measures nothing. This is the same failure that made
//      the first Pong build unloseable, caught the same way.
//
// ⚠️ A harness that passes while measuring nothing is worse than no harness, and the per-wall
// rule created four new ways for that to happen. Each is called out at the code below:
// silent settle bailouts, a retry loop that cannot fix a position refusal, a `sloppiness`
// axis that never moved a number, and a geometry check aimed at a spot nobody stands on.
//
// Exits non-zero on any assertion failure, so it can gate a commit.

import {
  GRID,
  ROOMS,
  SIDES,
  SOLID,
  SPAWN,
  TOTAL_WALLS,
  isDoorway,
  isSolid,
  roomAt,
  standPoint,
  type Side,
} from "@/components/tools/site-snap/house";
import {
  RUN_SECONDS,
  attemptCapture,
  newGame,
  positionVerdict,
  shotPreview,
  step,
  summarise,
  type GameState,
} from "@/components/tools/site-snap/engine";

const DT = 1 / 60;
/** Mirrors PLAYER_HALF in the engine. Only used to test the player's box against geometry. */
const PLAYER_HALF = 0.3;

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

type Cell = { x: number; y: number };
const cellKey = (x: number, y: number) => y * GRID.w + x;

function bfsFrom(from: Cell): Int32Array {
  const dist = new Int32Array(GRID.w * GRID.h).fill(-1);
  if (isSolid(from.x, from.y)) return dist;
  const queue: number[] = [cellKey(from.x, from.y)];
  dist[queue[0]] = 0;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const cx = cur % GRID.w;
    const cy = Math.floor(cur / GRID.w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID.w || ny >= GRID.h) continue;
      if (SOLID[ny][nx]) continue;
      const nk = cellKey(nx, ny);
      if (dist[nk] !== -1) continue;
      dist[nk] = dist[cur] + 1;
      queue.push(nk);
    }
  }
  return dist;
}

function bfsPath(from: Cell, to: Cell): Cell[] | null {
  const dist = bfsFrom(from);
  const goal = cellKey(to.x, to.y);
  if (dist[goal] === -1) return null;
  // Walk the gradient backwards — cheaper than storing a parent array per query.
  const path: Cell[] = [to];
  let cur = to;
  while (dist[cellKey(cur.x, cur.y)] > 0) {
    const d = dist[cellKey(cur.x, cur.y)];
    const next = [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 },
    ].find(
      (c) =>
        c.x >= 0 &&
        c.y >= 0 &&
        c.x < GRID.w &&
        c.y < GRID.h &&
        dist[cellKey(c.x, c.y)] === d - 1
    );
    if (!next) return null;
    path.push(next);
    cur = next;
  }
  return path.reverse();
}

// ── Nodes: spawn plus the 28 stand points, and the distance matrix ──────
//
// ⚠️ ONE BFS per node, once, at module load. The old script ran a BFS per remaining ROOM per
// iteration — fine for 7 destinations, but 28 destinations naively is ~406 BFS per run, times
// 15 seeds, times every strategy.

type Node = { id: string; roomId: string; side: Side | null; x: number; y: number; cell: Cell };

const NODES: Node[] = [
  {
    id: "spawn",
    roomId: roomAt(SPAWN.x, SPAWN.y) ?? "hall",
    side: null,
    x: SPAWN.x,
    y: SPAWN.y,
    cell: { x: Math.floor(SPAWN.x), y: Math.floor(SPAWN.y) },
  },
  ...ROOMS.flatMap((r) =>
    SIDES.map((side) => {
      const w = standPoint(r.id, side);
      return {
        id: `${r.id}:${side}`,
        roomId: r.id,
        side,
        x: w.sx,
        y: w.sy,
        cell: { x: Math.floor(w.sx), y: Math.floor(w.sy) },
      };
    })
  ),
];

const NODE_INDEX = new Map(NODES.map((n, i) => [n.id, i]));
const FIELDS = NODES.map((n) => bfsFrom(n.cell));

function between(a: Node, b: Node): number {
  const d = FIELDS[NODE_INDEX.get(a.id)!][cellKey(b.cell.x, b.cell.y)];
  return d === -1 ? Number.POSITIVE_INFINITY : d;
}

const node = (roomId: string, side: Side) => NODES[NODE_INDEX.get(`${roomId}:${side}`)!];
const SPAWN_NODE = NODES[0];

// ── The route ───────────────────────────────────────────────────────────
//
// Two levels. Rooms are picked greedily (measuring to a room's NEAREST stand point, not to its
// centre — the centre is not somewhere anyone goes any more), and the four points inside a
// room are ordered by brute force over all 24 permutations, scored including the leg OUT to
// the next room.
//
// ⚠️ Do NOT replace this with a flat greedy over all 28 points. It measures 179 tiles against
// 165 for room-at-a-time, because greedy-nearest degrades as the node count rises — and 14
// tiles is 2.5 seconds is ~100 points of pure measurement error.

const PERMS: number[][] = (function build(rest: number[]): number[][] {
  if (rest.length <= 1) return [rest];
  return rest.flatMap((v, i) =>
    build([...rest.slice(0, i), ...rest.slice(i + 1)]).map((p) => [v, ...p])
  );
})([0, 1, 2, 3]);

function planRoute(): { route: Node[]; cost: number } {
  // Phase 1 — room order.
  const order: string[] = [];
  const left = new Set(ROOMS.map((r) => r.id));
  let handle = SPAWN_NODE;
  while (left.size > 0) {
    let best: { id: string; d: number } | null = null;
    for (const id of left) {
      const d = Math.min(...SIDES.map((s) => between(handle, node(id, s))));
      if (!best || d < best.d) best = { id, d };
    }
    order.push(best!.id);
    left.delete(best!.id);
    handle = SIDES.map((s) => node(best!.id, s)).reduce((a, b) =>
      between(handle, a) <= between(handle, b) ? a : b
    );
  }

  // Phase 2 — exact order within each room, knowing where we go next.
  const route: Node[] = [];
  let at = SPAWN_NODE;
  let cost = 0;
  for (let i = 0; i < order.length; i++) {
    const pts = SIDES.map((s) => node(order[i], s));
    const exits = order[i + 1] ? SIDES.map((s) => node(order[i + 1], s)) : [];

    let best: { t: number; p: Node[]; end: Node; inner: number } | null = null;
    for (const perm of PERMS) {
      const p = perm.map((k) => pts[k]);
      let inner = 0;
      let cur = at;
      for (const q of p) {
        inner += between(cur, q);
        cur = q;
      }
      const t = inner + (exits.length ? Math.min(...exits.map((e) => between(cur, e))) : 0);
      if (!best || t < best.t) best = { t, p, end: cur, inner };
    }
    route.push(...best!.p);
    cost += best!.inner;
    at = best!.end;
  }
  return { route, cost };
}

const PLAN = planRoute();

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

/** Does the player's whole box clear solid geometry here, not just its centre cell? */
function boxIsClear(x: number, y: number): boolean {
  for (const ax of [-PLAYER_HALF, PLAYER_HALF]) {
    for (const ay of [-PLAYER_HALF, PLAYER_HALF]) {
      if (isSolid(Math.floor(x + ax), Math.floor(y + ay))) return false;
    }
  }
  return true;
}

console.log("\nGeometry");

const spawnCell = SPAWN_NODE.cell;
check("spawn is walkable", !isSolid(spawnCell.x, spawnCell.y));

// ⚠️ This used to check every ROOM CENTRE was walkable and reachable. After the per-wall rule
// that is an assertion about a place nobody stands — it would have printed seven cheerful
// `ok` lines forever while saying nothing about the 28 points the game now depends on.
let badPoints = 0;
for (const n of NODES.slice(1)) {
  const w = standPoint(n.roomId, n.side!);
  const room = ROOMS.find((r) => r.id === n.roomId)!;
  const depth = n.side === "n" || n.side === "s" ? room.h : room.w;

  const ok =
    !isSolid(n.cell.x, n.cell.y) &&
    roomAt(n.x, n.y) === n.roomId &&
    !isDoorway(n.cell.x, n.cell.y) &&
    boxIsClear(n.x, n.y) &&
    between(SPAWN_NODE, n) !== Number.POSITIVE_INFINITY &&
    positionVerdict(n.roomId, n.side!, n.x, n.y).factor === 1 &&
    // The two clamp invariants: the point must be far enough off the wall behind it to stand,
    // and far enough off the wall in front of it to be a standoff at all. Break either and the
    // failure is SILENT — the settle loop spins out and the bot shoots from where it stalled.
    w.ideal > PLAYER_HALF &&
    w.ideal + PLAYER_HALF < depth;

  if (!ok) {
    badPoints++;
    console.log(`  FAIL stand point ${n.id} is not legal`);
  }
}
check(`all ${TOTAL_WALLS} stand points legal, reachable and scoring 1.00`, badPoints === 0);

check(
  `${TOTAL_WALLS} capture targets = ${ROOMS.length} rooms x 4`,
  TOTAL_WALLS === ROOMS.length * 4,
  `got ${TOTAL_WALLS} for ${ROOMS.length} rooms`
);
check("the run finishes outdoors", ROOMS.some((r) => r.kind === "outdoor"));

// ── Does the position model actually discriminate? ──────────────────────
//
// Without these, a sign error that made every point in a room score identically would leave
// every balance assertion below perfectly green — the rule would be gone and nothing would say
// so. They cost microseconds.

console.log("\nPosition model");

const refusedFromCentre = ROOMS.flatMap((r) =>
  SIDES.filter((s) => positionVerdict(r.id, s, r.cx, r.cy).code !== undefined).map(
    (s) => `${r.id}:${s}`
  )
);
check(
  "the old room-centre spot is refused on 6+ walls",
  refusedFromCentre.length >= 6,
  `${refusedFromCentre.length}: ${refusedFromCentre.join(" ")}`
);

/** Best "worst of the four walls" score available from any single spot in a room. */
function bestTripodScore(roomId: string): number {
  const r = ROOMS.find((rr) => rr.id === roomId)!;
  let best = 0;
  for (let x = r.x + PLAYER_HALF; x <= r.x + r.w - PLAYER_HALF; x += 0.1) {
    for (let y = r.y + PLAYER_HALF; y <= r.y + r.h - PLAYER_HALF; y += 0.1) {
      const worst = Math.min(...SIDES.map((s) => positionVerdict(roomId, s, x, y).factor));
      if (worst > best) best = worst;
    }
  }
  return best;
}

for (const id of ["hall", "living", "yard"]) {
  const best = bestTripodScore(id);
  check(`${id.padEnd(7)} cannot be shot from one spot`, best < 0.5, `best worst-wall = ${best.toFixed(2)}`);
}

// Named, deliberate, and asserted so it cannot change by accident: a room narrow enough that
// the ideal standoff is half its width IS a tripod room. The bathroom's east and west marks
// are 0.03 tiles apart. That is variety, not a bug.
const bathGap = Math.abs(standPoint("bath", "e").sx - standPoint("bath", "w").sx);
check("the bathroom is deliberately still a tripod room", bathGap < 0.2, `marks ${bathGap.toFixed(2)} apart`);

// The first two shots of a run are free from where you are standing. Kept: it is the best
// onboarding the game has — the flash goes off and a wall turns green before you have moved.
const spawnHall = (["n", "s"] as Side[]).every(
  (s) => positionVerdict("hall", s, SPAWN.x, SPAWN.y).factor === 1
);
check("spawn is a valid mark for the hall's long walls (onboarding)", spawnHall);

// ── The readout must not lie about the photo ────────────────────────────
//
// ⚠️ This got shipped wrong in BOTH directions inside one afternoon, so it is pinned here.
// The cone's OUTLINE is tinted by `framing` and its fill and the lit wall slice by `quality`;
// the captured wall strip is `qualityColour(state.captured[id])`. Those last two must agree,
// or the bar you aimed with is not the colour the wall keeps — "it goes green, I snap a photo,
// I walk away, it was actually red". Anything that reintroduces a gap between them breaks a
// promise the player can see.

const BAND = (q: number) => (q >= 80 ? "green" : q >= 50 ? "amber" : "red");

{
  const probe = newGame(() => 0.5);
  const mark = NODES[1];
  const w = standPoint(mark.roomId, mark.side!);
  probe.x = w.sx;
  probe.y = w.sy;
  probe.facing = mark.side!;
  // Hazards parked, so focus is the only thing moving.
  probe.cat.x = 33;
  probe.cat.y = 16;
  probe.cat.backoff = 999;
  for (const t of probe.toddlers) {
    t.x = 33;
    t.y = 5;
    t.backoff = 999;
  }
  probe.focus = 0;

  const framings: number[] = [];
  const qualities: number[] = [];
  for (let i = 0; i < 100; i++) {
    const shot = shotPreview(probe)!;
    framings.push(shot.framing);
    qualities.push(shot.quality);
    step(probe, 1 / 60, () => 0.5);
  }

  check(
    "framing is settled the moment you are on the mark",
    framings.every((f) => f === 100),
    `saw ${Math.min(...framings)}..${Math.max(...framings)}`
  );
  check(
    "the wall bar ripens red -> green as the camera steadies",
    BAND(qualities[0]) === "red" && BAND(qualities[qualities.length - 1]) === "green",
    `${qualities[0]}% (${BAND(qualities[0])}) -> ${qualities[qualities.length - 1]}% (${BAND(qualities[qualities.length - 1])})`
  );

  // The promise: shoot it green and the wall STAYS green. Both sides of this go through
  // qualityColour(), so it holds only while the bar reads `quality` and not `framing`.
  probe.focus = 1;
  const preview = shotPreview(probe)!;
  const taken = attemptCapture(probe);
  check(
    "the bar's colour is the colour the wall keeps",
    taken.ok && BAND(preview.quality) === BAND(taken.quality),
    taken.ok ? `bar ${BAND(preview.quality)} vs wall ${BAND(taken.quality)}` : "shot refused"
  );
}

console.log(`\n  planned route: ${PLAN.cost} tiles over ${PLAN.route.length} stand points`);

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
  /**
   * Position factor at which the bot stops walking and shoots.
   *
   * ⚠️ This replaced `sloppiness`, which measured NOTHING and never had: it was a random
   * offset from the park spot, the old perfect radius was 0.6, and six of the seven strategies
   * used offsets of 0.35 or less — so they all scored an identical 1.00 and the axis was
   * decorative. `precision` is the axis the per-wall rule actually creates: 1.0 walks until
   * the shot is worth full marks, 0.6 fires as soon as it is good enough and banks the clock.
   */
  precision: number;
  /** Takes the shot early when the cat closes in, rather than bracing for one it is about
   *  to ruin. A player learns this within two runs. */
  catAware: boolean;
  rand: () => number;
};

/** Nobody parks perfectly. A constant, not a strategy dimension — see `precision`. */
const JITTER = 0.15;

type RunResult = ReturnType<typeof summarise> & {
  stuck: boolean;
  clipped: boolean;
  /** ⚠️ Silent-failure counters. The settle and walk loops used to give up quietly and carry
   *  on, producing a completely plausible score from the wrong place. With 28 targets instead
   *  of 7 they have four times the chances to fire, so they are now recorded and asserted. */
  settleFails: number;
  walkFails: number;
  walked: number;
};

function playRun(opts: BotOpts): RunResult {
  const state = newGame(opts.rand);
  let clipped = false;
  let stuck = false;
  let settleFails = 0;
  let walkFails = 0;
  let walked = 0;
  let guard = 0;

  const advance = (steps = 1) => {
    for (let i = 0; i < steps; i++) {
      if (state.done) return;
      const px = state.x;
      const py = state.y;
      step(state, DT, opts.rand);
      walked += Math.hypot(state.x - px, state.y - py);
      if (!boxIsClear(state.x, state.y)) clipped = true;
      guard++;
      if (guard > 60 * (RUN_SECONDS + 5)) stuck = true;
    }
  };

  /** Hold both axes at once — the engine normalises a diagonal, so this is how a person moves
   *  and it is up to 29% shorter than following BFS cell centres. Returns true on arrival. */
  const driveTo = (tx: number, ty: number, tol: number, cap: number): boolean => {
    let hops = 0;
    while (!state.done && !stuck && Math.hypot(state.x - tx, state.y - ty) > tol) {
      clearInput(state);
      if (state.x < tx - tol / 2) state.input.right = true;
      else if (state.x > tx + tol / 2) state.input.left = true;
      if (state.y < ty - tol / 2) state.input.down = true;
      else if (state.y > ty + tol / 2) state.input.up = true;
      advance();
      if (++hops > cap) return false;
    }
    return true;
  };

  for (const target of PLAN.route) {
    if (state.done || stuck) break;
    const side = target.side!;

    // ── Walk there: BFS between rooms, straight line once inside the room ──
    if (roomAt(state.x, state.y) !== target.roomId) {
      const path = bfsPath({ x: Math.floor(state.x), y: Math.floor(state.y) }, target.cell);
      if (path) {
        for (const cell of path) {
          if (state.done || stuck) break;
          // The moment we are in the destination room, stop following cell centres and cut
          // straight across. Every room is a convex rectangle, so the line cannot cross a wall.
          if (roomAt(state.x, state.y) === target.roomId) break;
          if (!driveTo(cell.x + 0.5, cell.y + 0.5, 0.2, 400)) walkFails++;
        }
      } else {
        walkFails++;
      }
    }

    // ── Settle onto the mark, stopping as soon as the shot is good enough ──
    const jx = target.x + (opts.rand() * 2 - 1) * JITTER;
    const jy = target.y + (opts.rand() * 2 - 1) * JITTER;
    let settle = 0;
    let arrived = false;
    while (!state.done && !stuck && settle < 300) {
      if (positionVerdict(target.roomId, side, state.x, state.y).factor >= opts.precision) {
        arrived = true;
        break;
      }
      if (Math.hypot(state.x - jx, state.y - jy) <= 0.12) {
        arrived = true;
        break;
      }
      clearInput(state);
      if (state.x < jx - 0.05) state.input.right = true;
      else if (state.x > jx + 0.05) state.input.left = true;
      if (state.y < jy - 0.05) state.input.down = true;
      else if (state.y > jy + 0.05) state.input.up = true;
      advance();
      settle++;
    }
    if (!arrived) settleFails++;
    clearInput(state);
    // One idle step so speed drops to zero before pivoting. Without it the bot is still
    // moving when it taps a direction, so the turn-in-place branch doesn't fire, it WALKS
    // instead, and it slowly drifts off the mark until shots start getting refused.
    advance();

    if (state.done || stuck) break;

    // ── Face the wall ──
    if (state.facing !== side) {
      state.input[SIDE_INPUT[side]] = true;
      advance();
      clearInput(state);
      while (!state.done && state.turnLock > 0) advance();
    }

    const wallId = `${target.roomId}:${side}`;
    const braceFor = state.defects.has(wallId) ? opts.defectPatience : opts.patience;

    for (let attempt = 0; attempt < 4; attempt++) {
      if (state.done || stuck) break;

      // ⚠️ A refused shot used to be retried FROM THE SAME SPOT, which worked because the cat
      // was the only thing that could refuse a well-placed shot and it wanders off. A POSITION
      // refusal never fixes itself by waiting: four attempts later the wall is still not
      // captured, the survey is incomplete, the time bonus is zero, and this reports as a
      // legitimate strategy result. So re-park instead of re-firing.
      if (positionVerdict(target.roomId, side, state.x, state.y).code !== undefined) {
        if (!driveTo(target.x, target.y, 0.1, 200)) settleFails++;
        clearInput(state);
        advance();
        if (state.facing !== side) {
          state.input[SIDE_INPUT[side]] = true;
          advance();
          clearInput(state);
          while (!state.done && state.turnLock > 0) advance();
        }
      }

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

  // Let the clock run out if the survey finished early — the bonus is already banked by then.
  return { ...summarise(state), stuck, clipped, settleFails, walkFails, walked };
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
  const walked = median(runs.map((r) => r.walked));
  const complete = runs.filter((r) => r.complete).length;
  const clipped = runs.some((r) => r.clipped);
  const stuck = runs.some((r) => r.stuck);
  const settleFails = runs.reduce((a, r) => a + r.settleFails, 0);
  const walkFails = runs.reduce((a, r) => a + r.walkFails, 0);

  const tangles = median(runs.map((r) => r.tangles));
  const trips = median(runs.map((r) => r.trips));

  console.log(
    `  ${label.padEnd(26)} score=${String(score).padStart(5)}  ` +
      `time=${time.toFixed(1).padStart(5)}s  q=${quality.toFixed(0).padStart(3)}  ` +
      `walk=${walked.toFixed(0).padStart(3)}t  ` +
      `cat=${String(tangles).padStart(2)} trip=${String(trips).padStart(2)}  ` +
      `complete=${complete}/${n}` +
      `${clipped ? "  CLIPPED" : ""}${stuck ? "  STUCK" : ""}` +
      `${settleFails ? `  settleFails=${settleFails}` : ""}` +
      `${walkFails ? `  walkFails=${walkFails}` : ""}`
  );

  return { label, score, time, quality, walked, complete, n, clipped, stuck, settleFails, walkFails };
}

console.log("\nStrategies");
const results = [
  trials("rush everything", { patience: 0, defectPatience: 0, precision: 0.3, catAware: true }),
  trials("rush, care on defects", { patience: 0, defectPatience: 0.8, precision: 0.5, catAware: true }),
  trials("balanced", { patience: 0.35, defectPatience: 0.8, precision: 0.9, catAware: true }),
  trials("careful", { patience: 0.8, defectPatience: 1.2, precision: 1, catAware: true }),
  trials("perfectionist", { patience: 1.8, defectPatience: 1.8, precision: 1, catAware: true }),
  // Does BONUS_PER_SECOND make framing a genuine trade, or a mandatory tax? This one frames
  // "well enough" and banks the clock; if it ever WINS, positioning has stopped mattering.
  trials("good-enough framing", { patience: 0.35, defectPatience: 0.8, precision: 0.6, catAware: true }),
  // Isolates position from focus: walks every mark properly, never braces.
  trials("frames well, fires instantly", { patience: 0, defectPatience: 0, precision: 1, catAware: true }),
  trials("ignores the cat", { patience: 0.8, defectPatience: 1.2, precision: 1, catAware: false }),
];

console.log("\nAssertions");

check("player never clips into a wall", !results.some((r) => r.clipped));
check("no strategy gets stuck", !results.some((r) => r.stuck));

// These used to bail out silently. A plausible score from the wrong place is the worst kind of
// green, so they are hard failures now.
const settleFails = results.reduce((a, r) => a + r.settleFails, 0);
const walkFails = results.reduce((a, r) => a + r.walkFails, 0);
check("no bot ever fails to reach a mark", settleFails === 0, `${settleFails} settle bailouts`);
check("no bot ever fails to walk a path", walkFails === 0, `${walkFails} walk bailouts`);

const finishers = results.filter((r) => r.complete === r.n);
// Denominator DERIVED — it read "/6" against a 7-entry list, which is the sort of thing that
// gets quietly wronger every time a strategy is added.
check(
  "every sane strategy finishes in time",
  finishers.length >= results.length - 2,
  `${finishers.length}/${results.length}`
);

const rush = results[0];
const perfect = results[4];
const best = results.reduce((a, b) => (b.score > a.score ? b : a));

check(
  "best strategy is neither extreme",
  best !== rush && best !== perfect,
  `best = "${best.label}"`
);

// A routing regression — a bot ping-ponging between marks — is otherwise indistinguishable
// from a balance change. The walked figure is diagonal so it sits BELOW the BFS plan.
check(
  "the bot routes sanely",
  best.walked <= PLAN.cost * 1.15,
  `walked ${best.walked.toFixed(0)}t against a ${PLAN.cost}t plan`
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
