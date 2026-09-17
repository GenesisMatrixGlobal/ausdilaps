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
  contentBounds,
  deriveWalls,
  doorGeometry,
  labelAnchor,
  labelWidth,
  markPin,
  openingsFor,
  outdoorIds,
  placeDoors,
  stairGeometry,
  subtractOpenings,
  type Bounds,
} from "./grid";
import { a4Pixels, type Annotation, type FloorPlan, type Level, type Line, type Room, type Stair } from "./types";

const INK = "#2f343a";
/** A defect pin. Loud on purpose — a number keying the plan to the report has to be findable. */
const MARK_RED = "#d92b2b";
/** A figure pin. Same shape, so the two read as one system and not two. */
const FIGURE_INK = "#1f2327";
const HAIRLINE = "#c9ced4";
const GRID_LINE = "#e8eaed";

export type RenderOptions = {
  mode: "preview" | "export";
  dpi?: number;
  /** Rooms to draw with a selection highlight. Preview only. */
  selected?: string[];
  /** Which level to draw. Every level is its own page. Defaults to the first. */
  levelIndex?: number;
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
  bounds: Bounds;
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
  const index = Math.min(Math.max(0, opts.levelIndex ?? 0), plan.levels.length - 1);

  // Bounds for EVERY level, not just the one being drawn, because the scale is shared across
  // the whole plan: a smaller upper storey must still draw smaller on its own page rather than
  // swelling to fill it. That was true when levels stacked on one sheet and stays true now.
  const all = plan.levels.map((level) => {
    const owner = buildOwnerGrid(level.rooms, grid);
    return { level, owner, bounds: contentBounds(level, owner, grid) };
  });
  const current = all[index];

  const captionFont = Math.round(page.w * 0.026);
  const addressFont = Math.round(page.w * 0.032);

  // Address and suburb on ONE line, with the level under it. Nothing is reserved for a title
  // block that has nothing to put in it.
  const addressLine = plan.address.trim();
  const levelName = current.level.name.trim();
  const titleH =
    (addressLine ? addressFont * 1.5 : 0) +
    (levelName ? captionFont * 1.6 : 0) +
    (addressLine || levelName ? addressFont * 0.9 : 0);

  const bodyH = Math.max(1, contentH - titleH);
  const widest = Math.max(1, ...all.map((l) => l.bounds.w));
  const tallest = Math.max(1, ...all.map((l) => l.bounds.h));
  const scale = Math.min(contentW / widest, bodyH / tallest);

  const bounds = current.bounds;
  const placed: Placed = {
    level: current.level,
    owner: current.owner,
    bounds,
    ox: margin + (contentW - bounds.w * scale) / 2 - bounds.x * scale,
    oy: margin + titleH + Math.max(0, (bodyH - bounds.h * scale) / 2) - bounds.y * scale,
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.w}" height="${page.h}" viewBox="0 0 ${page.w} ${page.h}">`
  );
  parts.push(`<rect width="${page.w}" height="${page.h}" fill="#ffffff"/>`);
  parts.push(
    `<style>text{font-family:Arial,Helvetica,sans-serif;fill:${INK}}` +
      `.rm{text-anchor:middle;dominant-baseline:central}` +
      `.cap{text-anchor:middle;font-weight:700}` +
      // White on a solid badge, so it stays legible over a wall line or a satellite photo.
      `.mk{text-anchor:middle;dominant-baseline:central;font-weight:700;fill:#ffffff}</style>`
  );

  if (opts.mode === "preview") parts.push(previewGrid(placed, scale));

  parts.push(drawLevel(placed, grid, scale, opts));

  // The arrow sits in the title band beside the address, clear of the drawing. Anchoring it to
  // the drawing's own corner collided with the building whenever the plan filled the content
  // width, which a wide single-storey layout always does.
  parts.push(northArrow(plan.north, margin + contentW, margin, page.w * 0.075));

  let ty = margin + addressFont * 1.1;
  if (addressLine) {
    parts.push(
      `<text class="cap" x="${r2(page.w / 2)}" y="${r2(ty)}" font-size="${addressFont}">${esc(addressLine)}</text>`
    );
    ty += captionFont * 1.6;
  }
  if (levelName) {
    parts.push(
      `<text class="cap" x="${r2(page.w / 2)}" y="${r2(ty)}" font-size="${captionFont}">${esc(levelName)}</text>`
    );
  }

  parts.push("</svg>");
  return parts.join("");
}

function previewGrid(p: Placed, scale: number): string {
  const lines: string[] = [];
  {
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

  // Under the walls, deliberately: the symbol is filled white so its treads read, and a
  // staircase drawn flush to a wall would otherwise rub that wall out.
  for (const stair of level.stairs) out.push(stairSymbol(stair, ox, oy, scale));

  const walls = deriveWalls(owner, grid, outdoorIds(level.rooms));
  // A doorway and a rubbed-out wall are the same thing to a wall run.
  const openings = [...doors, ...openingsFor(owner, grid, level.removedWalls)];
  const ext: string[] = [];
  const int: string[] = [];
  const area: string[] = [];
  for (const seg of walls) {
    for (const piece of subtractOpenings(seg, openings)) {
      const d =
        seg.orient === "v"
          ? `M${r2(ox + seg.pos * scale)} ${r2(oy + piece.from * scale)}V${r2(oy + piece.to * scale)}`
          : `M${r2(ox + piece.from * scale)} ${r2(oy + seg.pos * scale)}H${r2(ox + piece.to * scale)}`;
      (seg.kind === "external" ? ext : seg.kind === "area" ? area : int).push(d);
    }
  }
  // Areas first, under everything: a driveway edge should never sit on top of a real wall.
  out.push(
    `<path d="${area.join("")}" stroke="${HAIRLINE}" stroke-width="${r2(internal)}" fill="none" ` +
      `stroke-dasharray="${r2(scale * 0.3)} ${r2(scale * 0.2)}"/>`
  );
  out.push(
    `<path d="${int.join("")}" stroke="${INK}" stroke-width="${r2(internal)}" fill="none" stroke-linecap="butt"/>`
  );
  out.push(
    `<path d="${ext.join("")}" stroke="${INK}" stroke-width="${r2(external)}" fill="none" stroke-linecap="butt"/>`
  );

  for (const door of doors) {
    const g = doorGeometry(door);
    const px = (x: number) => r2(ox + x * scale);
    const py = (y: number) => r2(oy + y * scale);
    const stroke = `stroke="${INK}" stroke-width="${r2(internal * 0.8)}" fill="none"`;

    for (const leaf of g.leaves) {
      const rad = r2(leaf.radius * scale);
      out.push(
        `<path d="M${px(leaf.hinge.x)} ${py(leaf.hinge.y)}L${px(leaf.tip.x)} ${py(leaf.tip.y)}` +
          `A${rad} ${rad} 0 0 ${leaf.sweep} ${px(leaf.jamb.x)} ${py(leaf.jamb.y)}" ${stroke}/>`
      );
    }
    for (const [x1, y1, x2, y2] of g.panels) {
      out.push(`<path d="M${px(x1)} ${py(y1)}L${px(x2)} ${py(y2)}" ${stroke}/>`);
    }
  }

  out.push(drawLines(level, ox, oy, scale, internal));

  for (const room of level.rooms) out.push(roomLabel(room, ox, oy, scale));
  for (const ann of level.annotations) out.push(annotationChip(ann, level, ox, oy, scale));

  return out.join("");
}

/** How wide a gate is, in cells. */
const GATE_CELLS = 1;

/**
 * Drawn lines: fences, free-standing walls, and counters.
 *
 * Stored rather than derived, so they come straight off the level. A fence keeps the dashed
 * grey an outdoor area's edge uses — both say "boundary, not wall" — while a drawn wall is
 * indistinguishable from a derived one, because it is one. A counter gets two thin parallel
 * lines: a bench has depth, and it must not read as a wall you cannot walk past.
 */
function drawLines(level: Level, ox: number, oy: number, scale: number, internal: number): string {
  if (level.lines.length === 0) return "";

  const px = (x: number) => r2(ox + x * scale);
  const py = (y: number) => r2(oy + y * scale);
  const runs: Record<Line["kind"], string[]> = { fence: [], wall: [], counter: [] };
  const gates: string[] = [];

  /** A segment along the line, `off` it perpendicularly. */
  const seg = (line: Line, from: number, to: number, off = 0) =>
    line.orient === "v"
      ? `M${px(line.pos + off)} ${py(from)}V${py(to)}`
      : `M${px(from)} ${py(line.pos + off)}H${px(to)}`;

  for (const line of level.lines) {
    const gateFrom = line.gate;
    const gateTo = gateFrom === undefined ? 0 : Math.min(gateFrom + GATE_CELLS, line.to);
    const open = gateFrom !== undefined && gateFrom > line.from && gateFrom < line.to;

    const pieces: Array<[number, number]> = open
      ? [[line.from, gateFrom!], [gateTo, line.to]].filter(([a, b]) => b > a) as Array<[number, number]>
      : [[line.from, line.to]];

    for (const [from, to] of pieces) {
      if (line.kind === "counter") {
        runs.counter.push(seg(line, from, to, -0.07), seg(line, from, to, 0.07));
      } else {
        runs[line.kind].push(seg(line, from, to));
      }
    }

    // The gate leaf: hinged at the near jamb, swung a quarter turn off the line.
    if (open) {
      const w = gateTo - gateFrom!;
      const hinge = line.orient === "v" ? [line.pos, gateFrom!] : [gateFrom!, line.pos];
      const tip = line.orient === "v" ? [line.pos + w, gateFrom!] : [gateFrom!, line.pos + w];
      const jamb = line.orient === "v" ? [line.pos, gateTo] : [gateTo, line.pos];
      const rad = r2(w * scale);
      gates.push(
        `M${px(hinge[0])} ${py(hinge[1])}L${px(tip[0])} ${py(tip[1])}` +
          `A${rad} ${rad} 0 0 ${line.orient === "v" ? 1 : 0} ${px(jamb[0])} ${py(jamb[1])}`
      );
    }
  }

  const out: string[] = [];
  if (runs.fence.length > 0)
    out.push(
      `<path d="${runs.fence.join("")}" stroke="${HAIRLINE}" stroke-width="${r2(internal)}" fill="none" ` +
        `stroke-dasharray="${r2(scale * 0.3)} ${r2(scale * 0.2)}"/>`
    );
  if (runs.wall.length > 0)
    out.push(
      `<path d="${runs.wall.join("")}" stroke="${INK}" stroke-width="${r2(internal)}" fill="none" stroke-linecap="butt"/>`
    );
  if (runs.counter.length > 0)
    out.push(
      `<path d="${runs.counter.join("")}" stroke="${INK}" stroke-width="${r2(internal * 0.6)}" fill="none"/>`
    );
  if (gates.length > 0)
    out.push(`<path d="${gates.join("")}" stroke="${HAIRLINE}" stroke-width="${r2(internal)}" fill="none"/>`);

  return out.join("");
}

function roomLabel(room: Room, ox: number, oy: number, scale: number): string {
  if (!room.label.trim()) return "";
  const anchor = labelAnchor(room);
  const base = Math.max(6, scale * 0.34);
  // labelWidth, not rect.w: a turned label reads up the page, so the space it has to fit into
  // is the rect's height.
  const { lines, font } = fitLabel(room.label.trim(), labelWidth(room) * scale * 0.88, base);
  const cx = ox + anchor.x * scale;
  const cy = oy + anchor.y * scale;
  const startY = cy - ((lines.length - 1) * font * 1.15) / 2;
  const body = lines
    .map(
      (line, i) =>
        `<text class="rm" x="${r2(cx)}" y="${r2(startY + i * font * 1.15)}" font-size="${r2(font)}">${esc(
          line
        )}</text>`
    )
    .join("");
  // -90 so it reads bottom-to-top, which is how every reference plan writes a name into a
  // balcony or a hallway too narrow to take it across.
  return room.labelAngle === 90 ? `<g transform="rotate(-90 ${r2(cx)} ${r2(cy)})">${body}</g>` : body;
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

  if (ann.kind === "mark") {
    // Bigger than a room label (0.34) so it reads as an overlay on the plan, not part of it.
    const size = Math.max(7, scale * 0.4);
    const pin = markPin(ann.text, size);
    const cx = ox + gx * scale;
    const cy = oy + gy * scale;
    const fill = ann.tone === "figure" ? FIGURE_INK : MARK_RED;
    const tail = pin.tail.map(([px, py]) => `${r2(cx + px)},${r2(cy + py)}`).join(" ");
    return (
      `<g><polygon points="${tail}" fill="${fill}"/>` +
      `<rect x="${r2(cx + pin.box.x)}" y="${r2(cy + pin.box.y)}" width="${r2(pin.box.w)}" ` +
      `height="${r2(pin.box.h)}" rx="${r2(pin.radius)}" fill="${fill}"/>` +
      `<text class="mk" x="${r2(cx)}" y="${r2(cy + pin.textY)}" font-size="${r2(size)}">${esc(ann.text)}</text></g>`
    );
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

/**
 * A staircase: outline, treads, and the direction of travel.
 *
 * The geometry comes from stairGeometry() in grid units; this only maps it onto the page, so
 * the editor canvas can draw the identical symbol from the identical numbers.
 */
function stairSymbol(stair: Stair, ox: number, oy: number, scale: number): string {
  const g = stairGeometry(stair);
  const px = (x: number) => r2(ox + x * scale);
  const py = (y: number) => r2(oy + y * scale);
  const stroke = Math.max(0.6, scale * 0.06);

  const treads = g.treads
    .map(([x1, y1, x2, y2]) => `M${px(x1)} ${py(y1)}L${px(x2)} ${py(y2)}`)
    .join("");
  const head = g.arrow.head.map(([x, y]) => `${px(x)},${py(y)}`).join(" ");

  return (
    `<g fill="none" stroke="${INK}" stroke-width="${r2(stroke)}">` +
    `<rect x="${px(g.outline.x)}" y="${py(g.outline.y)}" width="${r2(g.outline.w * scale)}" ` +
    `height="${r2(g.outline.h * scale)}" fill="#ffffff"/>` +
    `<path d="${treads}"/>` +
    `<path d="M${px(g.arrow.x1)} ${py(g.arrow.y1)}L${px(g.arrow.x2)} ${py(g.arrow.y2)}"/>` +
    `<polygon points="${head}" fill="${INK}"/>` +
    `</g>`
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
