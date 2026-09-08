// Site Snap — pixel art, written as pictures rather than as code.
//
// Each sprite is an array of strings, one character per pixel, decoded against a palette.
// The alternative — hand-writing a few hundred ctx.fillRect calls per frame — is unreadable,
// unmaintainable and genuinely slow at 60fps. This way the art is editable in place: you can
// see the little inspector in the source.
//
// Every sprite is baked ONCE into an offscreen canvas at load and blitted with drawImage
// thereafter. That is also the only place ctx.imageSmoothingEnabled actually does anything —
// it has no effect on fillRect, which is what the rest of the renderer uses.

const PALETTE: Record<string, string> = {
  ".": "transparent",
  H: "#e8642a", // hard hat — the brand orange, and the one place it belongs on a person
  h: "#b84a1c", // hat brim shadow
  S: "#f2c9a0", // skin
  s: "#d9a87e", // skin shadow
  D: "#4a3728", // hair
  V: "#46688a", // hi-vis vest — brand steel
  v: "#33506e", // vest shadow
  W: "#eef2f6", // hi-vis stripe
  B: "#3a4048", // trousers
  K: "#23272b", // boots
  C: "#23272b", // camera body
  L: "#8fb3d6", // lens glass
  G: "#d98a4a", // cat ginger
  g: "#b56f36", // cat shadow
  n: "#f2c9a0", // toddler skin
  m: "#c9736b", // toddler mouth
  j: "#e8b6c4", // toddler romper
  d: "#f7f3ea", // nappy
  k: "#d9a87e", // bare feet
  t: "#5f8a5c", // foliage
  O: "#b4653f", // terracotta pot
  o: "#8f4c2d", // pot shadow
  E: "#2f343a", // eyes
  P: "#f7f3ea", // highlight
};

/** Facing south — toward the viewer, camera up. */
const INSPECTOR_S = [
  "..HHHHHH..",
  ".HHHHHHHH.",
  "..hhhhhh..",
  "..SSSSSS..",
  "..SEssES..",
  ".VVVVVVVV.",
  ".VWCCCCWV.",
  ".VWCLLCWV.",
  ".VVCCCCVV.",
  ".VVVVVVVV.",
  "..BBBBBB..",
  "..BB..BB..",
  "..BB..BB..",
  "..KK..KK..",
];

/** Facing north — back of the head, camera hidden. */
const INSPECTOR_N = [
  "..HHHHHH..",
  ".HHHHHHHH.",
  "..hhhhhh..",
  "..DDDDDD..",
  "..DDDDDD..",
  ".VVVVVVVV.",
  ".VWVVVVWV.",
  ".VWVVVVWV.",
  ".VVVVVVVV.",
  ".VVVVVVVV.",
  "..BBBBBB..",
  "..BB..BB..",
  "..BB..BB..",
  "..KK..KK..",
];

/** Facing east — profile, camera out in front. West is this mirrored. */
const INSPECTOR_E = [
  "..HHHHH...",
  ".HHHHHHH..",
  "..hhhhh...",
  "..SSSSs...",
  "..SSEs....",
  ".VVVVV....",
  ".VWVVCCC..",
  ".VWVVCLC..",
  ".VVVVCCC..",
  ".VVVVV....",
  "..BBBB....",
  "..BBBB....",
  "..BB.BB...",
  "..KK.KK...",
];

/** Ginger cat, facing right, tail up. Bigger than the first pass, which at 8x6 was a
 *  smudge you could not identify at 1x — and an unidentifiable cat is a confusing hazard
 *  rather than a funny one. */
const CAT_R = [
  "..G...G...G",
  "..GGGGG..GG",
  ".GEGGGEG.G.",
  ".GGGgGGG.G.",
  "GGGGGGGGGG.",
  "gGGGGGGGGg.",
  ".g.gg.gg...",
];

/** Toddler: big head, nappy, tiny arms out for balance — yours, not theirs. */
const TODDLER = [
  "..nnnn..",
  ".nnnnnn.",
  ".nEnnEn.",
  ".nnmmnn.",
  "j.jjjj.j",
  ".jjjjjj.",
  "..dddd..",
  "..d..d..",
  "..k..k..",
];

/** The inspector flat on their back, hard hat rolling away. Wider than tall, which is what
 *  sells "fallen over" at this size — a rotated standing sprite just looks like a bug. */
const FALLEN = [
  "....hhhh....H",
  "...SSSSSS..HH",
  "..VVVVVVVV.H.",
  ".VWCCCCWVV...",
  ".VVCLLCVVV...",
  "..BBBBBBB....",
  "..KK...KK....",
];

/** A pot plant. Pure decoration, but it is most of what makes a room read as lived in. */
const PLANT = [
  "..t.t...",
  ".ttttt..",
  "t.tttt.t",
  "..ttt...",
  "..OOO...",
  "..ooo...",
];

export type SpriteKey =
  | "n"
  | "e"
  | "s"
  | "w"
  | "cat"
  | "catL"
  | "plant"
  | "toddler"
  | "fallen";

const cache = new Map<SpriteKey, HTMLCanvasElement>();

function bake(rows: string[], mirror: boolean): HTMLCanvasElement {
  const h = rows.length;
  const w = rows[0].length;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][mirror ? w - 1 - x : x];
      const colour = PALETTE[ch];
      if (!colour || colour === "transparent") continue;
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

/** Bake every sprite once. Safe to call repeatedly; only the first does work. */
export function loadSprites(): void {
  if (cache.size > 0) return;
  cache.set("s", bake(INSPECTOR_S, false));
  cache.set("n", bake(INSPECTOR_N, false));
  cache.set("e", bake(INSPECTOR_E, false));
  cache.set("w", bake(INSPECTOR_E, true));
  cache.set("cat", bake(CAT_R, false));
  cache.set("catL", bake(CAT_R, true));
  cache.set("plant", bake(PLANT, false));
  cache.set("toddler", bake(TODDLER, false));
  cache.set("fallen", bake(FALLEN, false));
}

export function sprite(key: SpriteKey): HTMLCanvasElement | undefined {
  return cache.get(key);
}

export const INSPECTOR_W_PX = INSPECTOR_S[0].length;
export const INSPECTOR_H_PX = INSPECTOR_S.length;
export const CAT_W_PX = CAT_R[0].length;
export const CAT_H_PX = CAT_R.length;
export const PLANT_W_PX = PLANT[0].length;
export const PLANT_H_PX = PLANT.length;
export const TODDLER_W_PX = TODDLER[0].length;
export const TODDLER_H_PX = TODDLER.length;
export const FALLEN_W_PX = FALLEN[0].length;
export const FALLEN_H_PX = FALLEN.length;
