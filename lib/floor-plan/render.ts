// FloorPlan -> SVG. The single drawing path in this tool.
//
// The client inlines the result for the live preview; the server hands the identical string
// to sharp for the PNG. One function means the preview cannot drift from the export — there
// is no second implementation to keep in step.
//
// House style follows the reports team's own reference ("Draft" in TEAM RESOURCE.xlsx):
// levels stacked down the page, each captioned underneath, north arrow beside the first,
// address in two lines at the foot.

import {
  buildOwnerGrid,
  deriveWalls,
  labelAnchor,
  labelRect,
  levelBounds,
  placeDoors,
  subtractOpenings,
} from "./grid";
import { a4Pixels, type Annotation, type FloorPlan, type Level, type Room } from "./types";

const INK = "#2f343a";
const HAIRLINE = "#c9ced4";
const GRID_LINE = "#e8eaed";

export type RenderOptions = {
  mode: "preview" | "export";
  dpi?: number;
  /** Rooms to draw with a selection highlight. Preview only. */
  selected?: string[];
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Approximate text width. There is no font metrics API on the server, and the alternative
 * (shipping a metrics table) buys precision this does not need — the number only decides
 * whether a label wraps or shrinks.
 */
function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55;
}

function fitLabel(text: string, maxWidth: number, baseFont: number): { lines: string[]; font: number } {
  if (textWidth(text, baseFont) <= maxWidth) return { lines: [text], font: baseFont };

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    // Split at the point that gives the most even two-line break.
    let bestSplit = 1;
    let bestDelta = Infinity;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(" ");
      const b = words.slice(i).join(" ");
      const delta = Math.abs(textWidth(a, baseFont) - textWidth(b, baseFont));
      if (delta < bestDelta) {
        bestDelta = delta;
        bestSplit = i;
      }
    }
    const lines = [words.slice(0, bestSplit).join(" "), words.slice(bestSplit).join(" ")];
    const widest = Math.max(...lines.map((l) => textWidth(l, baseFont)));
    if (widest <= maxWidth) return { lines, font: baseFont };
    return { lines, font: Math.max(baseFont * 0.6, (maxWidth / widest) * baseFont) };
  }

  return { lines: [text], font: Math.max(baseFont * 0.6, (maxWidth / textWidth(text, baseFont)) * baseFont) };
}

type Placed = {
  level: Level;
  owner: ReturnType<typeof buildOwnerGrid>;
  bounds: ReturnType<typeof levelBounds>;
  /** Page offset of the level's top-left drawn cell. */
  ox: number;
  oy: number;
};

export function renderPlan(plan: FloorPlan, opts: RenderOptions): string {
  const dpi = opts.dpi ?? 150;
  const page = a4Pixels(dpi, plan.orientation);
  const margin = Math.round(Math.min(page.w, page.h) * 0.07);
  const contentW = page.w - margin * 2;
  const contentH = page.h - margin * 2;

  const grid = plan.grid;
  const levels = plan.levels.map((level) => {
    const owner = buildOwnerGrid(level.rooms, grid);
    return { level, owner, bounds: levelBounds(owner, grid) };
  });

  const captionFont = Math.round(page.w * 0.026);
  const addressFont = Math.round(page.w * 0.032);
  const captionGap = captionFont * 2.2;
  const levelGap = Math.round(page.h * 0.045);
  const addressBlockH = addressFont * 3.4;

  // One scale for every level, so a smaller upper storey reads as smaller — which is true,
  // and is what the reference plans show.
  const totalBoundsH = levels.reduce((sum, l) => sum + l.bounds.h, 0);
  const maxBoundsW = Math.max(...levels.map((l) => l.bounds.w));
  const fixedH = captionGap * levels.length + levelGap * (levels.length - 1) + addressBlockH;
  const scale = Math.min(contentW / maxBoundsW, Math.max(1, contentH - fixedH) / Math.max(1, totalBoundsH));

  // Centred in the space above the title block. On a portrait sheet a wide single-storey
  // building is far shorter than the page — top-aligning it left most of the sheet blank
  // below and read as unfinished. Once levels stack up and fill the height this converges on
  // top-aligned anyway, so it is never worse.
  const drawnH = totalBoundsH * scale + captionGap * levels.length + levelGap * (levels.length - 1);
  let cursorY = margin + Math.max(0, (contentH - addressBlockH - drawnH) / 2);

  const placed: Placed[] = levels.map(({ level, owner, bounds }) => {
    const ox = margin + (contentW - bounds.w * scale) / 2 - bounds.x * scale;
    const oy = cursorY - bounds.y * scale;
    cursorY += bounds.h * scale + captionGap + levelGap;
    return { level, owner, bounds, ox, oy };
  });

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.w}" height="${page.h}" viewBox="0 0 ${page.w} ${page.h}">`
  );
  parts.push(`<rect width="${page.w}" height="${page.h}" fill="#ffffff"/>`);
  parts.push(
    `<style>text{font-family:Arial,Helvetica,sans-serif;fill:${INK}}` +
      `.rm{text-anchor:middle;dominant-baseline:central}` +
      `.cap{text-anchor:middle;font-weight:700}</style>`
  );

  if (opts.mode === "preview") parts.push(previewGrid(placed, grid, scale));

  for (const p of placed) {
    parts.push(drawLevel(p, grid, scale, opts));
    const capY = p.oy + (p.bounds.y + p.bounds.h) * scale + captionGap * 0.62;
    parts.push(
      `<text class="cap" x="${r2(margin + contentW / 2)}" y="${r2(capY)}" font-size="${captionFont}">${esc(
        p.level.name
      )}</text>`
    );
  }

  const addrY = page.h - margin - addressFont * 1.6;

  // The arrow lives in the foot band beside the address, not up against the plan. Anchoring
  // it to the drawing's top-right corner collided with the building whenever the plan filled
  // the content width — which a wide single-storey layout always does.
  parts.push(northArrow(plan.north, margin + contentW, addrY - addressFont, page.w * 0.075));

  if (plan.address.trim()) {
    parts.push(
      `<text class="cap" x="${r2(page.w / 2)}" y="${r2(addrY)}" font-size="${addressFont}">${esc(
        plan.address.trim()
      )}</text>`
    );
  }
  if (plan.suburb.trim()) {
    parts.push(
      `<text class="cap" x="${r2(page.w / 2)}" y="${r2(addrY + addressFont * 1.3)}" font-size="${addressFont}">~${esc(
        plan.suburb.trim()
      )}~</text>`
    );
  }

  parts.push("</svg>");
  return parts.join("");
}

function previewGrid(placed: Placed[], grid: { w: number; h: number }, scale: number): string {
  const lines: string[] = [];
  for (const p of placed) {
    const { x, y, w, h } = p.bounds;
    for (let gx = x; gx <= x + w; gx++)
      lines.push(
        `<line x1="${r2(p.ox + gx * scale)}" y1="${r2(p.oy + y * scale)}" x2="${r2(p.ox + gx * scale)}" y2="${r2(
          p.oy + (y + h) * scale
        )}"/>`
      );
    for (let gy = y; gy <= y + h; gy++)
      lines.push(
        `<line x1="${r2(p.ox + x * scale)}" y1="${r2(p.oy + gy * scale)}" x2="${r2(
          p.ox + (x + w) * scale
        )}" y2="${r2(p.oy + gy * scale)}"/>`
      );
  }
  return `<g stroke="${GRID_LINE}" stroke-width="1">${lines.join("")}</g>`;
}

function drawLevel(p: Placed, grid: { w: number; h: number }, scale: number, opts: RenderOptions): string {
  const { level, owner, ox, oy } = p;
  const out: string[] = [];

  const external = Math.max(1.2, scale * 0.15);
  const internal = Math.max(0.8, scale * 0.085);
  const { placed: doors } = placeDoors(owner, grid, level.doors);

  if (opts.mode === "preview" && opts.selected?.length) {
    const sel = new Set(opts.selected);
    for (const room of level.rooms) {
      if (!sel.has(room.id)) continue;
      for (const r of room.rects)
        out.push(
          `<rect x="${r2(ox + r.x * scale)}" y="${r2(oy + r.y * scale)}" width="${r2(r.w * scale)}" height="${r2(
            r.h * scale
          )}" fill="#46688a" fill-opacity="0.12"/>`
        );
    }
  }

  const walls = deriveWalls(owner, grid);
  const ext: string[] = [];
  const int: string[] = [];
  for (const seg of walls) {
    for (const piece of subtractOpenings(seg, doors)) {
      const d =
        seg.orient === "v"
          ? `M${r2(ox + seg.pos * scale)} ${r2(oy + piece.from * scale)}V${r2(oy + piece.to * scale)}`
          : `M${r2(ox + piece.from * scale)} ${r2(oy + seg.pos * scale)}H${r2(ox + piece.to * scale)}`;
      (seg.external ? ext : int).push(d);
    }
  }
  out.push(
    `<path d="${int.join("")}" stroke="${INK}" stroke-width="${r2(internal)}" fill="none" stroke-linecap="butt"/>`
  );
  out.push(
    `<path d="${ext.join("")}" stroke="${INK}" stroke-width="${r2(external)}" fill="none" stroke-linecap="butt"/>`
  );

  for (const door of doors) {
    if (door.kind === "opening") continue;
    const w = (door.to - door.from) * scale;
    // Hinging at the far end reverses the along-wall direction, which mirrors the arc.
    const along = door.hingeAt === "from" ? 1 : -1;
    const hingeAlong = door.hingeAt === "from" ? door.from : door.to;
    const hx = door.orient === "v" ? ox + door.pos * scale : ox + hingeAlong * scale;
    const hy = door.orient === "v" ? oy + hingeAlong * scale : oy + door.pos * scale;
    const tip =
      door.orient === "v" ? { x: hx + door.swingDir * w, y: hy } : { x: hx, y: hy + door.swingDir * w };
    const jamb =
      door.orient === "v" ? { x: hx, y: hy + along * w } : { x: hx + along * w, y: hy };
    const turns = door.swingDir * along === 1;
    const sweep = door.orient === "v" ? (turns ? 1 : 0) : turns ? 0 : 1;
    const dash = door.confidence === "inferred" ? ` stroke-dasharray="${r2(scale * 0.14)}"` : "";
    out.push(
      `<path d="M${r2(hx)} ${r2(hy)}L${r2(tip.x)} ${r2(tip.y)}A${r2(w)} ${r2(w)} 0 0 ${sweep} ${r2(jamb.x)} ${r2(
        jamb.y
      )}" stroke="${INK}" stroke-width="${r2(internal * 0.8)}" fill="none"${dash}/>`
    );
  }

  for (const room of level.rooms) out.push(roomLabel(room, ox, oy, scale));
  for (const ann of level.annotations) out.push(annotationChip(ann, level, ox, oy, scale));

  return out.join("");
}

function roomLabel(room: Room, ox: number, oy: number, scale: number): string {
  if (!room.label.trim()) return "";
  const rect = labelRect(room);
  const anchor = labelAnchor(room);
  const base = Math.max(6, scale * 0.34);
  const { lines, font } = fitLabel(room.label.trim(), rect.w * scale * 0.88, base);
  const cx = ox + anchor.x * scale;
  const cy = oy + anchor.y * scale;
  const startY = cy - ((lines.length - 1) * font * 1.15) / 2;
  return lines
    .map(
      (line, i) =>
        `<text class="rm" x="${r2(cx)}" y="${r2(startY + i * font * 1.15)}" font-size="${r2(font)}">${esc(
          line
        )}</text>`
    )
    .join("");
}

/**
 * A chip drawn under its room's label.
 *
 * An "auto" chip (name-matched from a Salesforce survey record, not yet confirmed) is dashed
 * on purpose: a photo range against the wrong room is a real liability in a dilapidation
 * report, so a guess must not look like a checked fact.
 */
function annotationChip(ann: Annotation, level: Level, ox: number, oy: number, scale: number): string {
  // Bound to a const so the union narrows inside the find() closure below.
  const anchor = ann.anchor;
  let gx: number;
  let gy: number;
  if (anchor.type === "room") {
    const room = level.rooms.find((r) => r.id === anchor.roomId);
    // The room was deleted out from under the chip. Drop it rather than draw it at 0,0.
    if (!room) return "";
    const a = labelAnchor(room);
    gx = a.x + anchor.dx;
    gy = a.y + anchor.dy + 0.55;
  } else {
    gx = anchor.x;
    gy = anchor.y;
  }

  const font = Math.max(5, scale * 0.28);
  const padX = font * 0.5;
  const w = textWidth(ann.text, font) + padX * 2;
  const h = font * 1.65;
  const x = ox + gx * scale - w / 2;
  const y = oy + gy * scale - h / 2;
  const dash = ann.placement === "auto" ? ` stroke-dasharray="${r2(font * 0.4)}"` : "";
  return (
    `<g><rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="${r2(h * 0.28)}" fill="#ffffff" ` +
    `stroke="${INK}" stroke-width="${r2(Math.max(0.6, scale * 0.035))}"${dash}/>` +
    `<text class="rm" x="${r2(x + w / 2)}" y="${r2(y + h / 2)}" font-size="${r2(font)}">${esc(ann.text)}</text></g>`
  );
}

/** North arrow, rotated so it points the way the sketch's compass actually pointed. */
function northArrow(north: number, right: number, top: number, size: number): string {
  const cx = right - size / 2;
  const cy = top + size / 2;

  // Everything is a fraction of the circle's radius, so the parts cannot drift apart:
  // the N rides at 0.78R with a 0.30R glyph, which puts its cap at ~0.93R — inside the
  // ring — and its foot clear of the needle tip at 0.56R.
  const R = size * 0.5;
  const tip = R * 0.56;
  const barb = R * 0.44;
  const halfWidth = R * 0.25;
  const notch = R * 0.16;
  const labelR = R * 0.78;
  const font = R * 0.3;

  const needle = `M0 ${r2(-tip)}L${r2(halfWidth)} ${r2(barb)}L0 ${r2(notch)}L${r2(-halfWidth)} ${r2(barb)}Z`;

  return (
    `<g transform="translate(${r2(cx)} ${r2(cy)})">` +
    `<circle r="${r2(R)}" fill="none" stroke="${HAIRLINE}" stroke-width="${r2(size * 0.028)}"/>` +
    `<g transform="rotate(${north})">` +
    `<path d="${needle}" fill="${INK}"/>` +
    // Counter-rotated so the glyph stays upright while riding the needle's tip — at north=180
    // a naively rotated "N" prints upside down.
    `<g transform="translate(0 ${r2(-labelR)}) rotate(${-north})">` +
    `<text class="cap" x="0" y="0" font-size="${r2(font)}" dominant-baseline="central">N</text>` +
    `</g></g></g>`
  );
}
