// Site Snap — the game itself, deliberately outside React and outside the DOM.
//
// Everything here is plain data and pure functions over one mutable state object. That is
// not stylistic: it is what lets scripts/check-site-snap.ts drive thousands of simulated
// runs with no canvas, which is how the balance gets tuned and how "can the player clip
// through a wall" gets answered. On the Pong build every real bug lived in the engine and
// every one was found by simulation rather than by watching the screen.
//
// All positions are in TILE UNITS, not pixels. The renderer multiplies by TILE; the
// simulation never learns how big it is on screen.
//
// ── WHERE THE DIFFICULTY ACTUALLY COMES FROM ────────────────────────────
// The first draft of this scored `avgQuality x clamp(par/elapsed)`, and it was broken in the
// same way the first draft of Pong was broken: a competent player saturated it instantly.
// Two reasons, both worth keeping in mind before changing anything below.
//
//   1. The time term was free. A full route is ~90 tiles of walking; at 5.5 tiles/sec that
//      is ~16s, and captures added ~10s. Every real run came in around 25s, which sat at the
//      multiplier's 1.5 ceiling, so the clock never mattered.
//   2. Quality was free. All four walls of a room share ONE optimal stand-point — the
//      centre — so once you had walked there, four perfect shots cost nothing more than four
//      key presses. Twenty-four captures were really six decisions.
//
// The FOCUS METER is the fix for (2) and it is the heart of the game. Standing still, the
// camera steadies from FOCUS_FLOOR to full over FOCUS_TIME. Fire whenever you like. That
// makes every one of the 24 shots its own speed-versus-quality decision instead of a
// formality, and it does it while keeping the brief's rule — you still shoot from the centre
// of the room — completely intact.
//
// The FIXED CLOCK plus a completion-only bonus is the fix for (1): time is only worth
// something if you actually finish the survey, which is also true of the real job.

import {
  isSolid,
  pathCells,
  room,
  roomAt,
  SPAWN,
  TOTAL_WALLS,
  WALLS,
  walkableCells,
  type Side,
} from "./house";

/** Cached once — the layout is fixed, so recomputing it per retreat is pure waste. */
const WALKABLE = walkableCells();

// ── Tuning ──────────────────────────────────────────────────────────────
// Starting points. scripts/check-site-snap.ts sweeps these and asserts the optimum is
// interior — i.e. that both rushing and perfectionism lose to playing well.

const PLAYER_SPEED = 5.5; // tiles/sec
const PLAYER_HALF = 0.3; // half-width; must stay under 1.0 or a 2-tile doorway won't fit

/** Quality is 1.0 inside this radius of the room centre... */
const PERFECT_RADIUS = 0.6;
/** ...decaying to 0 here, beyond which the shot is refused outright. */
const MAX_RADIUS = 2.6;

/**
 * Time constant for the camera steadying, in seconds. Focus approaches 1 exponentially:
 * ~63% after one TAU, ~86% after two, ~95% after three.
 *
 * EXPONENTIAL, NOT LINEAR, and that is the whole reason the game has a decision in it. With
 * focus ramping linearly, quality was linear in time spent and so was the clock bonus — two
 * straight lines, so the trade never peaked, it only tilted. Every strategy from "fire
 * instantly" to "wait for perfect" scored within 4% of the others. An exponential approach
 * gives diminishing returns per second waited, which is what creates an interior optimum:
 * the first fraction of a second buys a lot of quality, the last buys almost none.
 *
 * Paid PER SHOT — see the reset in attemptCapture(). With focus persisting across shots, one
 * wait covered all four walls of a room and quality outvalued the clock by roughly 12x.
 */
const FOCUS_TAU = 0.45;
/** What a shot is worth the instant you stop moving. The floor is low on purpose: a blurred
 *  photo is worthless in a real dilapidation report, and a generous floor is exactly what
 *  lets a rusher win. */
const FOCUS_FLOOR = 0.2;
/** Below this speed the camera counts as steady and focus builds. */
const STILL_SPEED = 0.25;

/** Pivoting on the spot does NOT cost focus — that is what makes taking all four walls from
 *  one tripod spot the intended play. Only actually travelling resets it. */
const TURN_TIME = 0.12;

/** One run, fixed. Ends here or on completion, whichever comes first. */
export const RUN_SECONDS = 60;
/**
 * Points per whole second left on the clock — paid ONLY on a complete survey.
 *
 * This is THE balance knob, and the acceptance test in scripts/check-site-snap.ts is that the
 * best play sits between "rush everything" and "perfect everything", with both extremes well
 * below it. Raise it and rushing wins; drop it and patience wins. Tune this, not the quality
 * curve — the quality curve is what the player can see and reason about.
 */
const BONUS_PER_SECOND = 40;

/** Walls with a visible crack, chosen fresh each run. Worth double, so you have to look
 *  around the room rather than spin on the spot, and the fixed house can't be memorised. */
const DEFECT_COUNT = 5;
const DEFECT_MULTIPLIER = 2;

/** Minimum gap between shots. Kept short: the cooldown is dead time during which focus is
 *  building for free, so a long one hands the rusher most of the quality curve for nothing. */
const SHUTTER_COOLDOWN = 0.15;

// ── Hazards ─────────────────────────────────────────────────────────────
//
// The cat and the toddlers punish OPPOSITE behaviours, and that is the entire point of
// having both. The cat hunts you while you stand still — which is exactly what the focus
// meter asks you to do — so bracing for a perfect shot is never free. The toddlers only trip
// you while you are moving, so sprinting between rooms is never free either. Neither hazard
// has a strategy that beats it; you have to keep switching, which is what stops the middle
// of the run going flat.
//
// Both are ESCAPABLE and both BACK OFF after they land a hit. A hazard that can pin you
// indefinitely makes the survey uncompletable, and the completion bonus unreachable through
// no fault of the player — the same trap the cat's first "refuse the shot" version fell into.

/** Slower than the player (5.5), so you can always walk away from it. */
const CAT_SPEED = 2.9;
/** Inside this, the cat is at your ankles and the camera will not steady at all. */
const CAT_CATCH_RADIUS = 0.9;
/** After a tangle it scampers off, so it can never lock a room permanently. */
const CAT_BACKOFF = 2.6;
/** How far to the side of the shot the cat still counts as being in frame. */
const CAT_FRAME_HALF_WIDTH = 1.2;
/**
 * What a photo is worth with the cat in frame.
 *
 * It SPOILS the shot, it does not refuse it. Refusing was the first version and it could
 * strand a wall for good: if the cat settled in front of a wall the player could not
 * photograph it at all, so the survey could never be completed. Scoring it low instead keeps
 * the hazard and the laugh, and leaves the retake as the player's decision.
 */
const CAT_IN_SHOT_FACTOR = 0.4;

const TODDLER_COUNT = 2;
/** Toddlers are slow. They get you by being underfoot, not by outrunning you. */
const TODDLER_SPEED = 2.1;
/** Trips only fire inside this AND only while you are actually moving. */
const TODDLER_TRIP_RADIUS = 0.62;
/** Flat on your back: no moving, no shooting, no focus. */
const STUN_TIME = 1.3;
/** Grace after getting up, so you cannot be chain-tripped by the same toddler. */
const TRIP_GRACE = 1.4;
const TODDLER_BACKOFF = 2.2;

/** How often a chaser re-plans its route, in seconds. */
const REPLAN_INTERVAL = 0.35;

// ── State ───────────────────────────────────────────────────────────────

export type Input = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  shutter: boolean;
};

export type Toast = {
  text: string;
  kind: "good" | "bad";
  x: number;
  y: number;
  age: number;
};

export type Outcome = "complete" | "timeout";

export type GameState = {
  elapsed: number;
  x: number;
  y: number;
  facing: Side;
  /** Tiles/sec actually travelled last step — drives the walk bob and the focus reset. */
  speed: number;
  /** 0..1 camera steadiness. The core mechanic. */
  focus: number;
  turnLock: number;
  input: Input;
  shutterWasDown: boolean;
  shutterCooldown: number;
  /** Best quality (0-100) per wall id. Absent = not yet captured. */
  captured: Record<string, number>;
  /** Wall ids carrying a visible defect this run. */
  defects: Set<string>;
  shots: number;
  cat: Chaser;
  toddlers: Chaser[];
  /** Seconds left flat on the floor after a trip. */
  stun: number;
  /** Seconds of trip immunity after getting back up. */
  grace: number;
  tangles: number;
  trips: number;
  flash: number;
  toasts: Toast[];
  done: boolean;
  outcome: Outcome | null;
};

export type Chaser = {
  x: number;
  y: number;
  /** Cells still to walk. Re-planned on a timer rather than every frame. */
  path: Array<{ x: number; y: number }>;
  replanIn: number;
  /** >0 means it is retreating rather than hunting, after landing a hit. */
  backoff: number;
  /** Where it is retreating to while backoff runs down. */
  retreatX?: number;
  retreatY?: number;
  facingRight: boolean;
};

function chaser(x: number, y: number): Chaser {
  return { x, y, path: [], replanIn: 0, backoff: 0, facingRight: true };
}

function pickDefects(rand: () => number): Set<string> {
  const pool = WALLS.map((w) => w.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return new Set(pool.slice(0, DEFECT_COUNT));
}

export function newGame(rand: () => number = Math.random): GameState {
  return {
    elapsed: 0,
    x: SPAWN.x,
    y: SPAWN.y,
    facing: "s",
    speed: 0,
    focus: 1,
    turnLock: 0,
    input: { up: false, down: false, left: false, right: false, shutter: false },
    shutterWasDown: false,
    shutterCooldown: 0,
    captured: {},
    defects: pickDefects(rand),
    shots: 0,
    cat: chaser(23, 14.5),
    // Spawned in rooms away from the hall, so nobody is standing on the player at t=0.
    toddlers: [chaser(4, 3.5), chaser(26, 14.5)].slice(0, TODDLER_COUNT),
    stun: 0,
    grace: 0,
    tangles: 0,
    trips: 0,
    flash: 0,
    toasts: [],
    done: false,
    outcome: null,
  };
}

export function remainingSeconds(state: GameState): number {
  return Math.max(0, RUN_SECONDS - state.elapsed);
}

// ── Movement ────────────────────────────────────────────────────────────

/**
 * Resolve one axis of movement against solid tiles.
 *
 * Axis-separated so sliding along a wall works: blocked heading north-east into a corner,
 * you still travel east. Resolving both axes together stops you dead instead, which is the
 * single biggest feel difference in a top-down game.
 */
function moveX(state: GameState, dx: number): void {
  if (dx === 0) return;
  let nx = state.x + dx;
  const top = Math.floor(state.y - PLAYER_HALF);
  const bottom = Math.floor(state.y + PLAYER_HALF);

  if (dx > 0) {
    const cell = Math.floor(nx + PLAYER_HALF);
    for (let cy = top; cy <= bottom; cy++) {
      if (isSolid(cell, cy)) {
        nx = cell - PLAYER_HALF - 1e-6;
        break;
      }
    }
  } else {
    const cell = Math.floor(nx - PLAYER_HALF);
    for (let cy = top; cy <= bottom; cy++) {
      if (isSolid(cell, cy)) {
        nx = cell + 1 + PLAYER_HALF + 1e-6;
        break;
      }
    }
  }
  state.x = nx;
}

function moveY(state: GameState, dy: number): void {
  if (dy === 0) return;
  let ny = state.y + dy;
  const left = Math.floor(state.x - PLAYER_HALF);
  const right = Math.floor(state.x + PLAYER_HALF);

  if (dy > 0) {
    const cell = Math.floor(ny + PLAYER_HALF);
    for (let cx = left; cx <= right; cx++) {
      if (isSolid(cx, cell)) {
        ny = cell - PLAYER_HALF - 1e-6;
        break;
      }
    }
  } else {
    const cell = Math.floor(ny - PLAYER_HALF);
    for (let cx = left; cx <= right; cx++) {
      if (isSolid(cx, cell)) {
        ny = cell + 1 + PLAYER_HALF + 1e-6;
        break;
      }
    }
  }
  state.y = ny;
}

/** Largest distance the player may travel in one sub-step. Under half a tile, so nobody can
 *  ever start one side of a wall and finish the other without that tile being tested — the
 *  Pong tunnelling bug, headed off by construction rather than by hoping dt stays small. */
const MAX_SUBSTEP_TILES = 0.25;

function facingFor(dx: number, dy: number, current: Side): Side {
  if (dx === 0 && dy === 0) return current;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "e" : "w";
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? "s" : "n";
  return current; // exact diagonal — keep what we had rather than flip-flopping
}

// ── Chasers ─────────────────────────────────────────────────────────────

/**
 * Walk a chaser one step along its planned route.
 *
 * Routes come from a breadth-first search re-run every REPLAN_INTERVAL rather than every
 * frame — the player does not move far in a third of a second, and re-planning three actors
 * sixty times a second is wasted work. Between plans the chaser just follows the cells it
 * already has, which also gives it a slightly dim, committed look that suits both a cat and
 * a toddler.
 */
function stepChaser(
  c: Chaser,
  targetX: number,
  targetY: number,
  speed: number,
  dt: number,
  rand: () => number
): void {
  c.replanIn -= dt;
  if (c.replanIn <= 0) {
    c.replanIn = REPLAN_INTERVAL;
    const from = { x: Math.floor(c.x), y: Math.floor(c.y) };
    const to = { x: Math.floor(targetX), y: Math.floor(targetY) };
    const path = pathCells(from, to);
    // Drop the cell it is standing in, so it always has somewhere to go.
    c.path = path ? path.slice(1) : [];
  }

  // Within the same cell as the target, home straight at it — following cell centres for the
  // last half tile makes a chaser circle its prey instead of reaching it.
  let tx: number;
  let ty: number;
  if (c.path.length === 0) {
    tx = targetX;
    ty = targetY;
  } else {
    tx = c.path[0].x + 0.5;
    ty = c.path[0].y + 0.5;
  }

  const dx = tx - c.x;
  const dy = ty - c.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.12) {
    if (c.path.length > 0) c.path.shift();
    return;
  }

  const move = Math.min(dist, speed * dt);
  const nx = c.x + (dx / dist) * move;
  const ny = c.y + (dy / dist) * move;
  if (!isSolid(Math.floor(nx), Math.floor(ny))) {
    if (Math.abs(dx) > 0.01) c.facingRight = dx > 0;
    c.x = nx;
    c.y = ny;
  } else {
    // Wedged: force a re-plan next frame rather than grinding against the wall.
    c.replanIn = 0;
    c.path = [];
    if (rand() < 0.5) c.x += (rand() - 0.5) * 0.1;
  }
}

/** Somewhere to run off to after landing a hit — roughly the far side of the house. */
function retreatTarget(state: GameState, rand: () => number): { x: number; y: number } {
  const cells = WALKABLE;
  for (let i = 0; i < 24; i++) {
    const c = cells[Math.floor(rand() * cells.length)];
    if (Math.hypot(c.x + 0.5 - state.x, c.y + 0.5 - state.y) > 8) {
      return { x: c.x + 0.5, y: c.y + 0.5 };
    }
  }
  return { x: SPAWN.x, y: SPAWN.y };
}

function stepHazards(state: GameState, dt: number, rand: () => number): void {
  // ── Cat: hunts you, and breaks your focus when it gets to your ankles ──
  const cat = state.cat;
  if (cat.backoff > 0) {
    cat.backoff -= dt;
    if (cat.backoff <= 0) cat.replanIn = 0;
    stepChaser(cat, cat.retreatX ?? SPAWN.x, cat.retreatY ?? SPAWN.y, CAT_SPEED, dt, rand);
  } else {
    stepChaser(cat, state.x, state.y, CAT_SPEED, dt, rand);
    if (Math.hypot(cat.x - state.x, cat.y - state.y) < CAT_CATCH_RADIUS) {
      state.tangles++;
      state.focus = 0;
      cat.backoff = CAT_BACKOFF;
      const away = retreatTarget(state, rand);
      cat.retreatX = away.x;
      cat.retreatY = away.y;
      cat.replanIn = 0;
      cat.path = [];
      state.toasts.push({
        text: "cat at your ankles!",
        kind: "bad",
        x: state.x,
        y: state.y - 0.9,
        age: 0,
      });
    }
  }

  // ── Toddlers: get underfoot, and only trip you while you are moving ──
  for (const t of state.toddlers) {
    if (t.backoff > 0) {
      t.backoff -= dt;
      if (t.backoff <= 0) t.replanIn = 0;
      stepChaser(t, t.retreatX ?? SPAWN.x, t.retreatY ?? SPAWN.y, TODDLER_SPEED, dt, rand);
      continue;
    }
    stepChaser(t, state.x, state.y, TODDLER_SPEED, dt, rand);

    const close = Math.hypot(t.x - state.x, t.y - state.y) < TODDLER_TRIP_RADIUS;
    // Standing still, a toddler just hugs your leg. It is only a trip hazard if you are
    // walking into it — which is what makes it the mirror image of the cat.
    if (close && state.speed > STILL_SPEED && state.stun <= 0 && state.grace <= 0) {
      state.trips++;
      state.stun = STUN_TIME;
      state.focus = 0;
      t.backoff = TODDLER_BACKOFF;
      const away = retreatTarget(state, rand);
      t.retreatX = away.x;
      t.retreatY = away.y;
      t.replanIn = 0;
      t.path = [];
      state.toasts.push({
        text: "over you go!",
        kind: "bad",
        x: state.x,
        y: state.y - 0.9,
        age: 0,
      });
    }
  }
}

/** True while the cat is close enough that the camera will not steady. */
export function catOnAnkles(state: GameState): boolean {
  return Math.hypot(state.cat.x - state.x, state.cat.y - state.y) < CAT_CATCH_RADIUS;
}

/** Is the cat between the player and the wall being photographed? */
function catInShot(state: GameState, side: Side): boolean {
  if (roomAt(state.cat.x, state.cat.y) !== roomAt(state.x, state.y)) return false;
  const dx = state.cat.x - state.x;
  const dy = state.cat.y - state.y;

  switch (side) {
    case "n":
      return dy < 0 && Math.abs(dx) < CAT_FRAME_HALF_WIDTH;
    case "s":
      return dy > 0 && Math.abs(dx) < CAT_FRAME_HALF_WIDTH;
    case "w":
      return dx < 0 && Math.abs(dy) < CAT_FRAME_HALF_WIDTH;
    case "e":
      return dx > 0 && Math.abs(dy) < CAT_FRAME_HALF_WIDTH;
  }
}

// ── Step ────────────────────────────────────────────────────────────────

export type CaptureResult =
  | {
      ok: true;
      wallId: string;
      quality: number;
      improved: boolean;
      retake: boolean;
      defect: boolean;
      cat: boolean;
    }
  | { ok: false; reason: string };

/**
 * Advance the world by `dt` seconds. Returns a capture result if the shutter fired this step.
 *
 * The shutter is EDGE-TRIGGERED and consumed here rather than read as a level. Held down as a
 * level it would fire at the browser's key-repeat rate, which makes the run a contest between
 * keyboard firmwares.
 */
export function step(
  state: GameState,
  dt: number,
  rand: () => number = Math.random
): CaptureResult | null {
  if (state.done) return null;

  state.elapsed += dt;
  state.flash = Math.max(0, state.flash - dt);
  state.shutterCooldown = Math.max(0, state.shutterCooldown - dt);
  state.grace = Math.max(0, state.grace - dt);

  if (state.stun > 0) {
    state.stun -= dt;
    if (state.stun <= 0) state.grace = TRIP_GRACE;
  }
  for (const t of state.toasts) t.age += dt;
  state.toasts = state.toasts.filter((t) => t.age < 1.4);

  const { up, down, left, right } = state.input;
  let dx = (right ? 1 : 0) - (left ? 1 : 0);
  let dy = (down ? 1 : 0) - (up ? 1 : 0);

  if (dx !== 0 && dy !== 0) {
    // Normalise, or a diagonal is 41% free speed and every optimal route becomes a zigzag.
    dx *= Math.SQRT1_2;
    dy *= Math.SQRT1_2;
  }

  const floored = state.stun > 0;
  if (floored) {
    dx = 0;
    dy = 0;
  }

  const wantsToMove = dx !== 0 || dy !== 0;
  const desired = facingFor(dx, dy, state.facing);

  // Turn-in-place: from a standstill, changing direction costs a short pivot and no ground.
  // That is what lets you take all four walls from one spot without stepping off it. While
  // already running, turning is instant — a 120ms stall on every direction change mid-route
  // would feel broken.
  if (state.turnLock > 0) {
    state.turnLock -= dt;
    state.facing = desired;
    state.speed = 0;
  } else if (wantsToMove && desired !== state.facing && state.speed < STILL_SPEED) {
    state.facing = desired;
    state.turnLock = TURN_TIME;
    state.speed = 0;
  } else {
    state.facing = desired;
    const distance = Math.hypot(dx, dy) * PLAYER_SPEED * dt;
    state.speed = dt > 0 ? distance / dt : 0;

    if (distance > 0) {
      const steps = Math.max(1, Math.ceil(distance / MAX_SUBSTEP_TILES));
      const sx = (dx * PLAYER_SPEED * dt) / steps;
      const sy = (dy * PLAYER_SPEED * dt) / steps;
      for (let i = 0; i < steps; i++) {
        moveX(state, sx);
        moveY(state, sy);
      }
    }
  }

  // Focus: steadies while still, lost the moment you travel. Closed form rather than
  // `focus += (1 - focus) * dt / TAU`, so the result does not drift with frame rate.
  //
  // A cat winding round your ankles pins it at zero, which is the whole hazard: the shot you
  // were bracing for is the one it interrupts.
  if (floored || catOnAnkles(state)) {
    state.focus = 0;
  } else if (state.speed < STILL_SPEED) {
    state.focus = 1 - (1 - state.focus) * Math.exp(-dt / FOCUS_TAU);
  } else {
    state.focus = 0;
  }

  stepHazards(state, dt, rand);

  let result: CaptureResult | null = null;
  const pressed = state.input.shutter && !state.shutterWasDown;
  if (pressed && state.stun > 0) {
    reject(state, "you're on the floor!");
  } else if (pressed && state.shutterCooldown <= 0) {
    state.shutterCooldown = SHUTTER_COOLDOWN;
    result = attemptCapture(state);
    if (!result.ok) reject(state, result.reason);
  }
  state.shutterWasDown = state.input.shutter;

  if (Object.keys(state.captured).length >= TOTAL_WALLS) {
    state.done = true;
    state.outcome = "complete";
  } else if (state.elapsed >= RUN_SECONDS) {
    state.elapsed = RUN_SECONDS;
    state.done = true;
    state.outcome = "timeout";
  }

  return result;
}

// ── Capture ─────────────────────────────────────────────────────────────

/** Quality from how close to the room centre the shot was taken. */
export function centreFactor(distance: number): number {
  if (distance <= PERFECT_RADIUS) return 1;
  if (distance >= MAX_RADIUS) return 0;
  return 1 - (distance - PERFECT_RADIUS) / (MAX_RADIUS - PERFECT_RADIUS);
}

/** What the camera's steadiness is worth right now, 0.2 to 1.0. */
export function focusFactor(focus: number): number {
  return FOCUS_FLOOR + (1 - FOCUS_FLOOR) * Math.max(0, Math.min(1, focus));
}

export function attemptCapture(state: GameState): CaptureResult {
  const roomId = roomAt(state.x, state.y);
  if (!roomId) return { ok: false, reason: "Step into a room first" };

  const r = room(roomId);
  const distance = Math.hypot(state.x - r.cx, state.y - r.cy);
  if (distance >= MAX_RADIUS) return { ok: false, reason: "Too far from the centre" };

  const wallId = `${roomId}:${state.facing}`;
  const defect = state.defects.has(wallId);
  const cat = catInShot(state, state.facing);
  const quality = Math.round(
    100 * centreFactor(distance) * focusFactor(state.focus) * (cat ? CAT_IN_SHOT_FACTOR : 1)
  );

  const previous = state.captured[wallId];
  const retake = previous !== undefined;
  const improved = !retake || quality > previous;
  if (improved) state.captured[wallId] = quality;

  state.shots++;
  state.flash = 0.09;
  // Taking the shot spends the steadiness. See FOCUS_TIME.
  state.focus = 0;
  state.toasts.push({
    text: cat ? `${quality} · cat!` : defect ? `${quality} · defect x2` : String(quality),
    kind: quality >= 70 ? "good" : "bad",
    x: state.x,
    y: state.y - 0.9,
    age: 0,
  });

  return { ok: true, wallId, quality, improved, retake, defect, cat };
}

export function reject(state: GameState, reason: string): void {
  state.toasts.push({ text: reason, kind: "bad", x: state.x, y: state.y - 0.9, age: 0 });
}

// ── Scoring ─────────────────────────────────────────────────────────────

export type RunSummary = {
  captured: number;
  total: number;
  shots: number;
  tangles: number;
  trips: number;
  elapsed: number;
  /** Mean over ALL walls, not just the ones photographed. */
  avgQuality: number;
  qualityPoints: number;
  timeBonus: number;
  complete: boolean;
  score: number;
};

export function summarise(state: GameState): RunSummary {
  let qualityPoints = 0;
  let rawSum = 0;
  for (const [wallId, q] of Object.entries(state.captured)) {
    rawSum += q;
    qualityPoints += q * (state.defects.has(wallId) ? DEFECT_MULTIPLIER : 1);
  }

  const captured = Object.keys(state.captured).length;
  const complete = captured >= TOTAL_WALLS;

  // The clock only pays out on a finished survey. Without that condition the best strategy is
  // to shoot the easy half of the house and go home, which is exactly the behaviour the real
  // job cannot tolerate — an unphotographed wall is a hole in the report.
  const timeBonus = complete ? Math.floor(remainingSeconds(state)) * BONUS_PER_SECOND : 0;

  return {
    captured,
    total: TOTAL_WALLS,
    shots: state.shots,
    tangles: state.tangles,
    trips: state.trips,
    elapsed: state.elapsed,
    avgQuality: TOTAL_WALLS > 0 ? rawSum / TOTAL_WALLS : 0,
    qualityPoints: Math.round(qualityPoints),
    timeBonus,
    complete,
    score: Math.round(qualityPoints) + timeBonus,
  };
}

/** Highest reachable score, for the API's sanity ceiling. */
export const MAX_POSSIBLE_SCORE =
  (TOTAL_WALLS + DEFECT_COUNT * (DEFECT_MULTIPLIER - 1)) * 100 + RUN_SECONDS * BONUS_PER_SECOND;

/** Per-room progress, for the HUD. */
export function roomProgress(state: GameState): Array<{ id: string; done: number }> {
  const out = new Map<string, number>();
  for (const w of WALLS) out.set(w.roomId, 0);
  for (const id of Object.keys(state.captured)) {
    const roomId = id.split(":")[0];
    out.set(roomId, (out.get(roomId) ?? 0) + 1);
  }
  return [...out].map(([id, done]) => ({ id, done }));
}
