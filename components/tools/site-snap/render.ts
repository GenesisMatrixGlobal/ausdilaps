// Site Snap — drawing. Reads state, never writes it.
//
// Everything lands on integer pixels. A sprite blitted at x=104.37 gets anti-aliased by the
// browser no matter what imageSmoothingEnabled says, which against hard-edged pixel walls
// reads as a smeared, wobbling character — the sort of thing that looks like a bug rather
// than a style. State stays float; only the draw call rounds.

import {
  GRID,
  ROOMS,
  SIDES,
  SOLID,
  TILE,
  isDoorway,
  type Room,
  type Side,
} from "./house";
import { catOnAnkles, type GameState } from "./engine";
import {
  CAT_H_PX,
  CAT_W_PX,
  FALLEN_H_PX,
  FALLEN_W_PX,
  INSPECTOR_H_PX,
  INSPECTOR_W_PX,
  PLANT_H_PX,
  PLANT_W_PX,
  TODDLER_H_PX,
  TODDLER_W_PX,
  sprite,
} from "./sprites";

export const VIEW_W = GRID.w * TILE;
export const VIEW_H = GRID.h * TILE;

const C = {
  outside: "#8fa88f", // grass around the house
  wall: "#ece2d2",
  wallEdge: "#b3a58c",
  wallShadow: "#c9bca4",
  door: "#8a6a45",
  centre: "#46688a",
  good: "#4f9d69",
  mid: "#c9922f",
  bad: "#c0563a",
  pending: "rgba(47,52,58,0.10)",
  crack: "#7a4a3a",
  toastGood: "#2f6b45",
  toastBad: "#a33d24",
} as const;

/** A cosy floor colour per room, so rooms read as different places at a glance. */
const FLOOR: Record<string, string> = {
  bed1: "#cdb392",
  bath: "#b7ccd4",
  bed2: "#c9ae94",
  hall: "#c3a684",
  kitchen: "#d3c7b0",
  living: "#c8a97f",
};

type Furniture = { room: string; x: number; y: number; w: number; h: number; c: string };

/** Pot plants, in tile units (centre of the sprite). */
const PLANTS: Array<[number, number]> = [
  [9.6, 5.6],
  [17.6, 5.6],
  [21.6, 5.6],
  [1.7, 9.5],
  [29.6, 9.5],
  [1.8, 12.6],
  [15.6, 16.3],
];

/** Purely decorative — nothing here collides. Solid furniture would make the route a
 *  navigation puzzle, which is a different game and would break the tuned walking times. */
const FURNITURE: Furniture[] = [
  // Bedroom 1 — bed and a rug
  { room: "bed1", x: 1.3, y: 1.3, w: 2.4, h: 3.6, c: "#9fb4c9" },
  { room: "bed1", x: 1.3, y: 1.3, w: 2.4, h: 0.9, c: "#eef2f6" },
  { room: "bed1", x: 6.5, y: 4.2, w: 3.2, h: 2.0, c: "#b58f6e" },
  // Bathroom — tub and basin
  { room: "bath", x: 12.4, y: 1.4, w: 1.6, h: 3.0, c: "#eef4f7" },
  { room: "bath", x: 16.8, y: 1.4, w: 1.6, h: 1.1, c: "#e2ecf1" },
  // Bedroom 2 — bed and wardrobe
  { room: "bed2", x: 27.4, y: 1.3, w: 2.4, h: 3.6, c: "#c2a8c4" },
  { room: "bed2", x: 27.4, y: 1.3, w: 2.4, h: 0.9, c: "#eef2f6" },
  { room: "bed2", x: 20.3, y: 1.3, w: 1.3, h: 2.4, c: "#8d6b4d" },
  // Hallway — runner
  { room: "hall", x: 3.0, y: 9.2, w: 12.0, h: 0.7, c: "#a8785c" },
  // Kitchen — counter run and an island
  { room: "kitchen", x: 1.2, y: 15.6, w: 9.0, h: 1.1, c: "#9a8a72" },
  { room: "kitchen", x: 11.4, y: 12.3, w: 2.3, h: 1.4, c: "#8f8069" },
  // Living — sofa, rug, telly
  { room: "living", x: 15.3, y: 13.4, w: 3.4, h: 1.3, c: "#7f9a86" },
  { room: "living", x: 20.0, y: 13.0, w: 4.0, h: 2.4, c: "#b98f6a" },
  { room: "living", x: 29.4, y: 13.2, w: 1.2, h: 2.0, c: "#2f343a" },
];

function px(v: number): number {
  return Math.round(v * TILE);
}

function qualityColour(q: number): string {
  if (q >= 80) return C.good;
  if (q >= 50) return C.mid;
  return C.bad;
}

/** The strip just inside a room along one of its sides — where a wall's status is drawn. */
function wallStrip(r: Room, side: Side): { x: number; y: number; w: number; h: number } {
  const t = 0.14;
  switch (side) {
    case "n":
      return { x: r.x, y: r.y, w: r.w, h: t };
    case "s":
      return { x: r.x, y: r.y + r.h - t, w: r.w, h: t };
    case "w":
      return { x: r.x, y: r.y, w: t, h: r.h };
    case "e":
      return { x: r.x + r.w - t, y: r.y, w: t, h: r.h };
  }
}

function drawCrack(ctx: CanvasRenderingContext2D, r: Room, side: Side): void {
  const s = wallStrip(r, side);
  const horizontal = side === "n" || side === "s";
  ctx.strokeStyle = C.crack;
  ctx.lineWidth = 2;
  ctx.beginPath();

  if (horizontal) {
    const y = px(s.y + s.h / 2);
    const x0 = px(s.x + s.w / 2) - 14;
    ctx.moveTo(x0, y - 3);
    for (let i = 0; i < 5; i++) {
      ctx.lineTo(x0 + 6 * (i + 1), y + (i % 2 === 0 ? 3 : -3));
    }
  } else {
    const x = px(s.x + s.w / 2);
    const y0 = px(s.y + s.h / 2) - 14;
    ctx.moveTo(x - 3, y0);
    for (let i = 0; i < 5; i++) {
      ctx.lineTo(x + (i % 2 === 0 ? 3 : -3), y0 + 6 * (i + 1));
    }
  }
  ctx.stroke();
}

export function draw(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.imageSmoothingEnabled = false;

  // Ground
  ctx.fillStyle = C.outside;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Floors
  for (const r of ROOMS) {
    ctx.fillStyle = FLOOR[r.id] ?? "#c8ad8a";
    ctx.fillRect(px(r.x), px(r.y), px(r.w), px(r.h));
    // Floorboard lines — one every two tiles, barely there.
    ctx.fillStyle = "rgba(0,0,0,0.05)";
    for (let y = r.y + 2; y < r.y + r.h; y += 2) {
      ctx.fillRect(px(r.x), px(y), px(r.w), 1);
    }
  }

  // Doorway thresholds, under the walls so the wall edge overlaps them cleanly
  for (let y = 0; y < GRID.h; y++) {
    for (let x = 0; x < GRID.w; x++) {
      if (!SOLID[y][x] && isDoorway(x, y)) {
        ctx.fillStyle = C.door;
        ctx.fillRect(px(x), px(y), TILE, TILE);
      }
    }
  }

  // Walls — chunky, with a shadow along the bottom so they read as solid rather than painted
  for (let y = 0; y < GRID.h; y++) {
    for (let x = 0; x < GRID.w; x++) {
      if (!SOLID[y][x]) continue;
      ctx.fillStyle = C.wall;
      ctx.fillRect(px(x), px(y), TILE, TILE);
      if (y + 1 < GRID.h && !SOLID[y + 1][x]) {
        ctx.fillStyle = C.wallShadow;
        ctx.fillRect(px(x), px(y) + TILE - 4, TILE, 4);
      }
      ctx.fillStyle = C.wallEdge;
      if (y === 0 || !SOLID[y - 1][x]) ctx.fillRect(px(x), px(y), TILE, 1);
      if (x === 0 || !SOLID[y][x - 1]) ctx.fillRect(px(x), px(y), 1, TILE);
      if (x + 1 >= GRID.w || !SOLID[y][x + 1]) ctx.fillRect(px(x) + TILE - 1, px(y), 1, TILE);
    }
  }

  // Pot plants — drawn before the status strips so a strip always wins on top of one.
  for (const [x, y] of PLANTS) {
    const plant = sprite("plant");
    if (plant) {
      ctx.drawImage(
        plant,
        Math.round(x * TILE - PLANT_W_PX / 2),
        Math.round(y * TILE - PLANT_H_PX / 2),
        PLANT_W_PX,
        PLANT_H_PX
      );
    }
  }

  // Furniture
  for (const f of FURNITURE) {
    ctx.fillStyle = f.c;
    ctx.fillRect(px(f.x), px(f.y), px(f.w), px(f.h));
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.fillRect(px(f.x), px(f.y + f.h) - 2, px(f.w), 2);
  }

  // Wall status: every capture target, coloured by how good the photo was. This doubles as
  // the progress display — the job sheet is the house itself, so the player never has to
  // look away from the game to know what is left.
  for (const r of ROOMS) {
    for (const side of SIDES) {
      const id = `${r.id}:${side}`;
      const q = state.captured[id];
      const s = wallStrip(r, side);
      ctx.fillStyle = q === undefined ? C.pending : qualityColour(q);
      ctx.fillRect(px(s.x), px(s.y), px(s.w), px(s.h));
      if (state.defects.has(id)) drawCrack(ctx, r, side);
    }
  }

  // Room centres — the tripod spot you have to shoot from
  for (const r of ROOMS) {
    const cx = px(r.cx);
    const cy = px(r.cy);
    const pulse = 3 + Math.sin(state.elapsed * 3) * 1.5;
    ctx.strokeStyle = C.centre;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(cx, cy, 6 + pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.centre;
    ctx.fillRect(cx - 5, cy - 1, 10, 2);
    ctx.fillRect(cx - 1, cy - 5, 2, 10);
  }

  // Viewfinder — brackets on the wall currently aimed at, so "which wall am I shooting" is
  // never a guess. Brightness tracks focus, which is how the player learns the mechanic
  // without being told it exists.
  const aimed = aimedWall(state);
  if (aimed) {
    const s = wallStrip(aimed.room, aimed.side);
    const x = px(s.x);
    const y = px(s.y);
    const w = px(s.w);
    const h = px(s.h);
    const len = 7;
    ctx.strokeStyle = "#23272b";
    ctx.globalAlpha = 0.35 + 0.65 * state.focus;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.moveTo(x + w - len, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + len);
    ctx.moveTo(x, y + h - len);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + len, y + h);
    ctx.moveTo(x + w - len, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + h - len);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Toddlers
  const toddler = sprite("toddler");
  if (toddler) {
    for (const t of state.toddlers) {
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      ctx.fillRect(
        Math.round(t.x * TILE - TODDLER_W_PX / 2) + 1,
        Math.round(t.y * TILE + TODDLER_H_PX / 2) - 2,
        TODDLER_W_PX - 2,
        2
      );
      ctx.drawImage(
        toddler,
        Math.round(t.x * TILE - TODDLER_W_PX / 2),
        Math.round(t.y * TILE - TODDLER_H_PX / 2),
        TODDLER_W_PX,
        TODDLER_H_PX
      );
    }
  }

  // Cat — flipped from its own heading, not from where the player happens to be, or it
  // moonwalks whenever it runs away.
  const catSprite = sprite(state.cat.facingRight ? "cat" : "catL");
  if (catSprite) {
    ctx.drawImage(
      catSprite,
      Math.round(state.cat.x * TILE - CAT_W_PX / 2),
      Math.round(state.cat.y * TILE - CAT_H_PX / 2),
      CAT_W_PX,
      CAT_H_PX
    );
  }

  // Player — 1px vertical bob while walking reads as a walk cycle at this scale, and costs
  // nothing next to a second set of sprites.
  const bob = state.speed > 0.25 && Math.floor(state.elapsed * 9) % 2 === 0 ? 1 : 0;
  const floored = state.stun > 0;
  const who = sprite(floored ? "fallen" : state.facing);
  const spriteW = floored ? FALLEN_W_PX : INSPECTOR_W_PX;
  const spriteH = floored ? FALLEN_H_PX : INSPECTOR_H_PX;
  if (who) {
    // Soft shadow so the character sits on the floor rather than floating over it.
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(
      Math.round(state.x * TILE - spriteW / 2) + 2,
      Math.round(state.y * TILE + spriteH / 2) - 3,
      spriteW - 4,
      2
    );
    ctx.drawImage(
      who,
      Math.round(state.x * TILE - spriteW / 2),
      Math.round(state.y * TILE - spriteH / 2) + (floored ? 0 : bob),
      spriteW,
      spriteH
    );
  }

  // Dizzy stars while you are on the floor.
  if (floored) {
    ctx.fillStyle = "#c9922f";
    for (let i = 0; i < 3; i++) {
      const a = state.elapsed * 6 + (i * Math.PI * 2) / 3;
      ctx.fillRect(
        Math.round(state.x * TILE + Math.cos(a) * 7) - 1,
        Math.round(state.y * TILE - spriteH / 2 - 3 + Math.sin(a) * 3) - 1,
        2,
        2
      );
    }
  }

  // Focus ring — the mechanic made visible. It closes as the camera steadies.
  if (state.focus < 0.995) {
    const cx = Math.round(state.x * TILE);
    const cy = Math.round(state.y * TILE - INSPECTOR_H_PX / 2 - 4);
    ctx.strokeStyle = "#23272b";
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = catOnAnkles(state) ? C.bad : state.focus > 0.75 ? C.good : C.mid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * state.focus);
    ctx.stroke();
  }

  // Floating results
  ctx.font = "bold 9px ui-monospace, monospace";
  ctx.textAlign = "center";
  for (const t of state.toasts) {
    const rise = t.age * 14;
    ctx.globalAlpha = Math.max(0, 1 - t.age / 1.4);
    ctx.fillStyle = t.kind === "good" ? C.toastGood : C.toastBad;
    ctx.fillText(t.text, Math.round(t.x * TILE), Math.round(t.y * TILE - rise));
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";

  // Shutter flash
  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.75, state.flash * 7)})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

/** Which wall the player is currently pointed at, if they're standing in a room. */
export function aimedWall(state: GameState): { room: Room; side: Side } | null {
  const cx = Math.floor(state.x);
  const cy = Math.floor(state.y);
  if (cx < 0 || cy < 0 || cx >= GRID.w || cy >= GRID.h) return null;
  const r = ROOMS.find(
    (rr) => cx >= rr.x && cx < rr.x + rr.w && cy >= rr.y && cy < rr.y + rr.h
  );
  return r ? { room: r, side: state.facing } : null;
}
