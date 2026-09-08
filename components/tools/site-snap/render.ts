// Site Snap — drawing. Reads state, never writes it.
//
// Everything lands on integer pixels. A sprite blitted at x=104.37 gets anti-aliased by the
// browser no matter what imageSmoothingEnabled says, which against hard-edged pixel walls
// reads as a smeared, wobbling character — the sort of thing that looks like a bug rather
// than a style. State stays float; only the draw call rounds.
//
// The house is drawn ONCE into an offscreen canvas and blitted every frame. Floors, walls,
// windows, furniture and the yard never change during a run, and re-issuing ~900 fillRects
// sixty times a second to redraw a floor that has not moved is the easiest waste in the file
// to remove. Only the things that actually change — capture status, room markers, the cat,
// the toddlers, the player, effects — are drawn live on top.

import {
  GRID,
  ROOMS,
  SIDES,
  SOLID,
  TILE,
  isDoorway,
  isFenceCell,
  isSolid,
  isStructural,
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
  outside: "#7f9668",
  wall: "#efe6d6",
  wallCap: "#fbf6ec",
  wallEdge: "#a8987c",
  wallShadow: "#c2b394",
  skirting: "#d8cbb2",
  glass: "#a8cbdc",
  glassLit: "#c9e3ee",
  frame: "#8d7a5c",
  centre: "#46688a",
  good: "#4f9d69",
  mid: "#c9922f",
  bad: "#c0563a",
  pending: "rgba(47,52,58,0.10)",
  crack: "#7a4a3a",
  grass: "#7fa05e",
  grassDark: "#6d8c50",
  deck: "#b98d5d",
  deckLine: "#9c7247",
  fence: "#a8834f",
  fencePost: "#8b6a3d",
  toastGood: "#2f6b45",
  toastBad: "#a33d24",
} as const;

/** A cosy floor per room, so rooms read as different places at a glance. */
const FLOOR: Record<string, string> = {
  bed1: "#d3b894",
  bath: "#c2d6dd",
  bed2: "#cfb296",
  hall: "#c9ab87",
  kitchen: "#d8ccb4",
  living: "#cdae82",
  yard: C.grass,
};

/** Which rooms get a tiled floor rather than boards. */
const TILED = new Set(["bath", "kitchen"]);

type Prop =
  | { t: "bed"; x: number; y: number; w: number; h: number; c: string }
  | { t: "rug"; x: number; y: number; w: number; h: number; c: string; edge: string }
  | { t: "sofa"; x: number; y: number; w: number; h: number; c: string }
  | { t: "counter"; x: number; y: number; w: number; h: number; c: string }
  | { t: "box"; x: number; y: number; w: number; h: number; c: string }
  | { t: "tub"; x: number; y: number; w: number; h: number }
  | { t: "table"; x: number; y: number; w: number; h: number };

/** Purely decorative — nothing here collides. Solid furniture would turn the route into a
 *  navigation puzzle, which is a different game and would invalidate the tuned walking
 *  times the balance check depends on. */
const PROPS: Prop[] = [
  // Bedroom 1 (x2..9, y2..7) — bed, side table, wardrobe, rug
  { t: "bed", x: 2.3, y: 2.4, w: 2.6, h: 3.8, c: "#9fb4c9" },
  { t: "box", x: 5.2, y: 2.4, w: 1.0, h: 1.0, c: "#8d6b4d" },
  { t: "box", x: 8.4, y: 2.3, w: 1.4, h: 2.2, c: "#8d6b4d" },
  { t: "rug", x: 6.0, y: 4.8, w: 3.2, h: 2.2, c: "#c08d6d", edge: "#a3735a" },
  // Bathroom (x11..15, y2..7) — tub, basin, loo
  { t: "tub", x: 11.3, y: 2.4, w: 1.7, h: 3.2 },
  { t: "box", x: 14.2, y: 2.4, w: 1.4, h: 1.0, c: "#e8f0f4" },
  { t: "box", x: 14.3, y: 5.6, w: 1.2, h: 1.4, c: "#eef4f7" },
  // Bedroom 2 (x17..24, y2..7) — bed, wardrobe, desk, rug
  { t: "bed", x: 22.2, y: 2.4, w: 2.6, h: 3.8, c: "#c2a8c4" },
  { t: "box", x: 17.3, y: 2.3, w: 1.4, h: 2.4, c: "#8d6b4d" },
  { t: "box", x: 19.2, y: 2.4, w: 2.4, h: 1.1, c: "#9c7a58" },
  { t: "rug", x: 18.4, y: 4.9, w: 3.2, h: 2.1, c: "#a9bfa0", edge: "#8ba382" },
  // Hallway (x2..24, y9..11) — runner and a console table
  { t: "rug", x: 4.0, y: 10.1, w: 10.0, h: 0.9, c: "#a8785c", edge: "#8c6047" },
  { t: "box", x: 21.6, y: 9.2, w: 2.2, h: 0.7, c: "#8d6b4d" },
  // Kitchen (x2..10, y13..18) — counter run, island, fridge
  { t: "counter", x: 2.2, y: 17.4, w: 7.6, h: 1.2, c: "#a3917a" },
  { t: "counter", x: 5.4, y: 14.4, w: 3.0, h: 1.3, c: "#a3917a" },
  { t: "box", x: 2.3, y: 13.3, w: 1.5, h: 2.0, c: "#dfe4e8" },
  // Living (x12..24, y13..18) — sofa, rug, coffee table, telly, bookcase
  { t: "sofa", x: 12.4, y: 14.2, w: 1.3, h: 3.4, c: "#7f9a86" },
  { t: "rug", x: 14.4, y: 14.6, w: 4.6, h: 2.8, c: "#b98f6a", edge: "#9a7351" },
  { t: "table", x: 15.8, y: 15.5, w: 1.8, h: 1.1 },
  { t: "box", x: 23.4, y: 14.6, w: 1.2, h: 2.6, c: "#2f343a" },
  { t: "box", x: 19.4, y: 13.3, w: 2.6, h: 0.9, c: "#8d6b4d" },
  // Backyard (x27..33, y4..16) — deck at the back door, shed, veggie beds, path
  { t: "box", x: 27.1, y: 13.6, w: 2.4, h: 2.4, c: C.deck },
  { t: "box", x: 31.4, y: 4.4, w: 2.3, h: 2.1, c: "#8a8f94" },
  { t: "box", x: 27.3, y: 7.4, w: 2.0, h: 1.3, c: "#6f5a3e" },
  { t: "box", x: 27.3, y: 9.1, w: 2.0, h: 1.3, c: "#6f5a3e" },
  { t: "box", x: 31.3, y: 10.4, w: 1.4, h: 1.4, c: "#9aa06a" },
];

/** Hand-placed windows on external walls, in cells. */
const WINDOWS: Array<{ x: number; y: number; horizontal: boolean }> = [
  // Front elevation (the house's north wall, y=1)
  { x: 3, y: 1, horizontal: true },
  { x: 4, y: 1, horizontal: true },
  { x: 7, y: 1, horizontal: true },
  { x: 13, y: 1, horizontal: true },
  { x: 19, y: 1, horizontal: true },
  { x: 20, y: 1, horizontal: true },
  { x: 23, y: 1, horizontal: true },
  // West elevation (x=1)
  { x: 1, y: 4, horizontal: false },
  { x: 1, y: 5, horizontal: false },
  { x: 1, y: 15, horizontal: false },
  { x: 1, y: 16, horizontal: false },
  // Rear elevation (y=19)
  { x: 4, y: 19, horizontal: true },
  { x: 5, y: 19, horizontal: true },
  { x: 14, y: 19, horizontal: true },
  { x: 15, y: 19, horizontal: true },
  { x: 22, y: 19, horizontal: true },
  // East elevation, onto the yard
  { x: 25, y: 10, horizontal: false },
  { x: 25, y: 17, horizontal: false },
];

/** Pot plants, in tile units (centre of the sprite). */
const PLANTS: Array<[number, number]> = [
  [10.5, 6.6],
  [16.5, 6.6],
  [2.7, 10.6],
  [23.6, 10.6],
  [11.5, 17.5],
  [24.4, 17.5],
  [33.4, 5.5],
  [33.4, 15.5],
];

function px(v: number): number {
  return Math.round(v * TILE);
}

function qualityColour(q: number): string {
  if (q >= 80) return C.good;
  if (q >= 50) return C.mid;
  return C.bad;
}

// ── Props ───────────────────────────────────────────────────────────────

function drawProp(ctx: CanvasRenderingContext2D, p: Prop): void {
  const x = px(p.x);
  const y = px(p.y);
  const w = px(p.w);
  const h = px(p.h);

  switch (p.t) {
    case "bed": {
      ctx.fillStyle = "#8a6a4a";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = p.c;
      ctx.fillRect(x + 1, y + Math.round(h * 0.28), w - 2, h - Math.round(h * 0.28) - 1);
      ctx.fillStyle = "#f7f3ea";
      ctx.fillRect(x + 2, y + 2, w - 4, Math.round(h * 0.22));
      break;
    }
    case "rug": {
      ctx.fillStyle = p.edge;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = p.c;
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      break;
    }
    case "sofa": {
      ctx.fillStyle = p.c;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(x + Math.round(w * 0.45), y + 2, Math.round(w * 0.5), h - 4);
      break;
    }
    case "counter": {
      ctx.fillStyle = p.c;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#c9bda6";
      ctx.fillRect(x, y, w, 3);
      ctx.fillStyle = "#8d99a3"; // sink
      ctx.fillRect(x + Math.round(w * 0.55), y + 4, 10, Math.max(4, h - 7));
      break;
    }
    case "tub": {
      ctx.fillStyle = "#dfe9ee";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#f3f8fa";
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      break;
    }
    case "table": {
      ctx.fillStyle = "#a8845c";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(x + 1, y + 1, w - 2, 2);
      break;
    }
    default: {
      ctx.fillStyle = p.c;
      ctx.fillRect(x, y, w, h);
      break;
    }
  }
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(x, y + h, w, 2);
}

// ── The static layer ────────────────────────────────────────────────────

let staticLayer: HTMLCanvasElement | null = null;

function bakeStatic(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  // Ground beyond the house and yard
  ctx.fillStyle = C.outside;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Floors
  for (const r of ROOMS) {
    ctx.fillStyle = FLOOR[r.id] ?? "#c8ad8a";
    ctx.fillRect(px(r.x), px(r.y), px(r.w), px(r.h));

    if (r.kind === "outdoor") {
      // Grass tufts, scattered but deterministic so the lawn doesn't crawl between frames.
      ctx.fillStyle = C.grassDark;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if ((x * 7 + y * 13) % 5 === 0) ctx.fillRect(px(x) + 5, px(y) + 6, 3, 2);
          if ((x * 5 + y * 11) % 7 === 0) ctx.fillRect(px(x) + 10, px(y) + 11, 2, 2);
        }
      }
    } else if (TILED.has(r.id)) {
      ctx.fillStyle = "rgba(255,255,255,0.30)";
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if ((x + y) % 2 === 0) ctx.fillRect(px(x), px(y), TILE, TILE);
        }
      }
    } else {
      // Floorboards: a line every two tiles, plus staggered board ends.
      ctx.fillStyle = "rgba(0,0,0,0.06)";
      for (let y = r.y + 2; y < r.y + r.h; y += 2) ctx.fillRect(px(r.x), px(y), px(r.w), 1);
      ctx.fillStyle = "rgba(0,0,0,0.04)";
      for (let y = r.y; y < r.y + r.h; y += 2) {
        for (let x = r.x + ((y / 2) % 2 === 0 ? 3 : 6); x < r.x + r.w; x += 6) {
          ctx.fillRect(px(x), px(y), 1, TILE * 2);
        }
      }
    }
  }

  // Doorway thresholds, under the walls so the wall edge overlaps them cleanly
  for (let y = 0; y < GRID.h; y++) {
    for (let x = 0; x < GRID.w; x++) {
      if (SOLID[y][x] || !isDoorway(x, y)) continue;
      ctx.fillStyle = isFenceCell(x, y) ? C.deck : "#b08a55";
      ctx.fillRect(px(x), px(y), TILE, TILE);
      ctx.fillStyle = "rgba(0,0,0,0.14)";
      ctx.fillRect(px(x), px(y), TILE, 2);
    }
  }

  // Walls, and the yard's fence
  for (let y = 0; y < GRID.h; y++) {
    for (let x = 0; x < GRID.w; x++) {
      if (!SOLID[y][x]) continue;
      // Open ground beyond the property keeps the lawn colour already laid down.
      if (!isStructural(x, y)) continue;

      if (isFenceCell(x, y)) {
        // Palings rather than masonry — a boundary fence should not read as a wall.
        ctx.fillStyle = C.fence;
        ctx.fillRect(px(x), px(y) + 3, TILE, TILE - 6);
        ctx.fillStyle = C.fencePost;
        for (let i = 0; i < TILE; i += 4) ctx.fillRect(px(x) + i, px(y) + 3, 2, TILE - 6);
        ctx.fillRect(px(x), px(y) + 4, TILE, 1);
        ctx.fillRect(px(x), px(y) + TILE - 6, TILE, 1);
        continue;
      }

      ctx.fillStyle = C.wall;
      ctx.fillRect(px(x), px(y), TILE, TILE);
      // A lighter cap where the wall meets open floor above, and a shadow below, so walls
      // read as having thickness instead of looking painted on.
      if (y === 0 || !SOLID[y - 1][x]) {
        ctx.fillStyle = C.wallCap;
        ctx.fillRect(px(x), px(y), TILE, 3);
      }
      if (y + 1 < GRID.h && !SOLID[y + 1][x]) {
        ctx.fillStyle = C.wallShadow;
        ctx.fillRect(px(x), px(y) + TILE - 5, TILE, 5);
        ctx.fillStyle = C.skirting;
        ctx.fillRect(px(x), px(y) + TILE - 2, TILE, 2);
      }
      ctx.fillStyle = C.wallEdge;
      if (y === 0 || !SOLID[y - 1][x]) ctx.fillRect(px(x), px(y), TILE, 1);
      if (x === 0 || !SOLID[y][x - 1]) ctx.fillRect(px(x), px(y), 1, TILE);
      if (x + 1 >= GRID.w || !SOLID[y][x + 1]) ctx.fillRect(px(x) + TILE - 1, px(y), 1, TILE);
      if (y + 1 >= GRID.h || !SOLID[y + 1][x]) ctx.fillRect(px(x), px(y) + TILE - 1, TILE, 1);
    }
  }

  // Windows
  for (const win of WINDOWS) {
    if (!isSolid(win.x, win.y)) continue;
    const x = px(win.x);
    const y = px(win.y);
    ctx.fillStyle = C.frame;
    if (win.horizontal) ctx.fillRect(x + 1, y + 3, TILE - 2, TILE - 6);
    else ctx.fillRect(x + 3, y + 1, TILE - 6, TILE - 2);
    ctx.fillStyle = C.glass;
    if (win.horizontal) ctx.fillRect(x + 2, y + 4, TILE - 4, TILE - 8);
    else ctx.fillRect(x + 4, y + 2, TILE - 8, TILE - 4);
    ctx.fillStyle = C.glassLit;
    if (win.horizontal) ctx.fillRect(x + 3, y + 5, Math.round((TILE - 6) / 2), TILE - 10);
    else ctx.fillRect(x + 5, y + 3, TILE - 10, Math.round((TILE - 6) / 2));
  }

  // Props, then plants over the top
  for (const p of PROPS) drawProp(ctx, p);
  const plant = sprite("plant");
  if (plant) {
    for (const [x, y] of PLANTS) {
      ctx.drawImage(
        plant,
        Math.round(x * TILE - PLANT_W_PX / 2),
        Math.round(y * TILE - PLANT_H_PX / 2),
        PLANT_W_PX,
        PLANT_H_PX
      );
    }
  }

  return canvas;
}

/** Discards the baked house. Call if the layout or sprites ever change at runtime. */
export function invalidateStatic(): void {
  staticLayer = null;
}

// ── Live drawing ────────────────────────────────────────────────────────

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
    for (let i = 0; i < 5; i++) ctx.lineTo(x0 + 6 * (i + 1), y + (i % 2 === 0 ? 3 : -3));
  } else {
    const x = px(s.x + s.w / 2);
    const y0 = px(s.y + s.h / 2) - 14;
    ctx.moveTo(x - 3, y0);
    for (let i = 0; i < 5; i++) ctx.lineTo(x + (i % 2 === 0 ? 3 : -3), y0 + 6 * (i + 1));
  }
  ctx.stroke();
}

export function draw(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.imageSmoothingEnabled = false;
  if (!staticLayer) staticLayer = bakeStatic();

  // Shutter kick — a couple of pixels for a couple of frames. Whole pixels only, or the
  // baked house resamples and the entire scene shimmers on every shot.
  const kick = state.flash > 0.16 ? 2 : state.flash > 0.08 ? 1 : 0;
  const ox = kick === 0 ? 0 : (Math.random() < 0.5 ? -kick : kick);
  const oy = kick === 0 ? 0 : (Math.random() < 0.5 ? -kick : kick);

  ctx.save();
  ctx.translate(ox, oy);

  ctx.fillStyle = C.outside;
  ctx.fillRect(-4, -4, VIEW_W + 8, VIEW_H + 8);
  ctx.drawImage(staticLayer, 0, 0);

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
    const cy = Math.round(state.y * TILE - spriteH / 2 - 4);
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

  ctx.restore();

  drawFlash(ctx, state);
}

/**
 * The shutter going off.
 *
 * Three things at once, because one alone reads as a dropped frame rather than a camera: a
 * white blowout over the whole scene, a burst ring thrown out from where the shot was taken,
 * and the pixel kick applied above. The dud pulse is the same idea at a fraction of the
 * strength, so a refused press still looks like a press.
 */
function drawFlash(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (state.dud > 0) {
    ctx.fillStyle = `rgba(192,86,58,${Math.min(0.3, state.dud * 1.1)})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (state.flash <= 0) return;

  // 0 at the start of the flash, 1 as it dies.
  const t = 1 - state.flash / 0.26;

  // Cubic falloff, not quadratic. Punch is a HIGH PEAK that clears FAST — a quadratic
  // curve held the screen above 50% white for ~0.16s, which across 28 shots spends a real
  // fraction of the run unable to see the house. This hits harder and gets out of the way.
  ctx.fillStyle = `rgba(255,255,255,${Math.max(0, 0.95 * Math.pow(1 - t, 3))})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const cx = Math.round(state.flashX * TILE);
  const cy = Math.round(state.flashY * TILE);
  ctx.strokeStyle = `rgba(255,255,255,${Math.max(0, 1 - t)})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, 6 + t * 46, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = `rgba(255,244,214,${Math.max(0, 0.8 - t)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 3 + t * 26, 0, Math.PI * 2);
  ctx.stroke();
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
