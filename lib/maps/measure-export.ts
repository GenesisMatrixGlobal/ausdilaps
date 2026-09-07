// Renders the Measure tab's measurements as a flat PNG: the same aerial frame the operator
// was looking at, every shape drawn on it, a north arrow, and a legend keying each
// numbered shape to its area.
//
// Server-side out of necessity, not preference. Google Maps JS serves its tiles
// cross-origin, so the live map's canvas is tainted and cannot be read back — there is no
// client-side screenshot of it to be had at any price. The export is therefore a second,
// independent render through the Maps STATIC API, which is the same pipeline the Building
// Markup tab's .png download uses.

import sharp from "sharp";
import type { LatLng } from "@/lib/kml/types";
import { centroidOf, simplifyRing } from "@/lib/kml/standard-markup/geometry";
import {
  MIN_POINTS,
  formatArea,
  measureShape,
  ringFor,
  type Measurable,
} from "@/lib/kml/standard-markup/measure";
import {
  latLngToPixel,
  mercatorSpan,
  pixelToLatLng,
  type LatLngBox,
} from "@/lib/kml/standard-markup/projection";
import {
  FILL_OPACITY_PERCENT,
  OUTLINE_WEIGHT,
  SHAPE_COLORS,
  STROKE_OPACITY_PERCENT,
} from "@/lib/kml/standard-markup/style";
import { buildStaticMapUrl, GoogleMapsConfigError, SCALE } from "@/lib/kml/site-markup/static-map";
import { textToSvgPaths, textWidth } from "@/lib/kml/overlay/text-path";

export { GoogleMapsConfigError };

/** Google's hard cap on either `size` dimension. */
const MAX_STATIC_DIMENSION = 640;
/** Past this, AU aerial imagery is upsampled — the same ceiling the live map uses. */
const MAX_ZOOM = 21;
/**
 * Extra ground framed along the bottom, in logical (pre-`scale`) pixels, for Google's
 * attribution bar to sit on.
 *
 * Google draws "Google / Map data ©… Airbus, Maxar…" OVER the imagery, about 30 output px
 * tall at scale 2, so without this it occludes the bottom of the live view — and a
 * measurement drawn near the bottom edge disappears under it. Framing a strip of extra
 * ground is the only fix available: the bar's size is fixed by Google (it scales WITH
 * `scale`, so no scale/size combination shrinks it relative to the map), and cropping or
 * shrinking it is exactly what the Maps Platform terms forbid.
 */
const ATTRIBUTION_PAD_PX = 20;

/**
 * How much of a tile's bottom edge Google's attribution bar occupies, in logical px.
 *
 * Measured at ~15; 22 is that plus headroom, since the bar's height is not contractual.
 * Every tile EXCEPT the bottom-left one is requested this much taller and then cropped, so
 * the bar doesn't end up burned across the middle of the stitched image.
 */
const TILE_BAND_CROP_PX = 22;

/** Requests per export. Each is a billed Static Maps call, and at 8 a wide frame still gets
 *  the full 2x detail while a pathological one falls back to a single request. */
const MAX_TILES = 8;

/** One flat colour for every shape, unlike the live map's steel/orange selected split —
 *  an exported still has no notion of "selected", and orange is what reads over grass,
 *  bitumen and a tin roof alike. Same value the Building Markup shapes and the Road
 *  Markup line already use. */
const SHAPE_COLOR = SHAPE_COLORS.orange;
const INK = "23272b"; // ad-navy-deep
const MUTED = "5b6570"; // ad-muted
const STEEL = "46688a"; // ad-steel

export interface MeasureExportInput {
  /** Exactly what the live map had on screen. Bounds rather than centre+zoom: the live map
   *  allows FRACTIONAL zoom (17.5 is a real state) and Static Maps only accepts integers,
   *  so rounding the zoom would shift the frame by up to 40% of its area. A box is
   *  unambiguous at any zoom. */
  bounds: LatLngBox;
  mapType: "satellite" | "hybrid" | "roadmap";
  measurements: (Measurable & { id: string })[];
}

interface TileRect {
  /** Position within the whole frame, in logical px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** True for the one tile whose Google attribution bar is KEPT. */
  keepsAttribution: boolean;
}

interface RenderPlan {
  zoom: number;
  /** Whole-frame logical size, including the attribution pad in the height. */
  width: number;
  height: number;
  /** Centre of the whole frame. */
  center: LatLng;
  tiles: TileRect[];
  /** Linear detail multiplier over a single request — 1 or 2. The overlay is scaled by it
   *  so a badge and a legend row stay the same size relative to the map. */
  ui: number;
}

/** Even splits, so every tile's size and centre land on whole logical pixels. An odd size
 *  puts Static Maps' centre on a half pixel, which at scale 2 is a 1px seam. */
function evenBoundaries(total: number, count: number): number[] {
  const out = [0];
  for (let i = 1; i < count; i++) out.push(2 * Math.round((total * i) / count / 2));
  out.push(total);
  return out;
}

/**
 * Boundaries for the BOTTOM row, biased so the leftmost tile is as wide as Google allows.
 *
 * That tile is the one whose attribution bar is kept, and Google renders the provider list
 * to fit the width it was asked for — at 506px it clipped to "data ©2026 Google Imagery…",
 * losing the leading "Map". A full-width tile gives it room for the whole credit. The
 * remainder splits evenly across the rest, and always fits: cols = ceil(width / 640)
 * guarantees width <= 640 * cols.
 */
function attributionBiasedBoundaries(total: number, count: number): number[] {
  if (count === 1 || total <= MAX_STATIC_DIMENSION) return evenBoundaries(total, count);
  const first = MAX_STATIC_DIMENSION;
  const rest = evenBoundaries(total - first, count - 1);
  return [0, ...rest.map((x) => x + first)];
}

/**
 * Plans the requests that cover exactly the given bounds, at the finest detail available.
 *
 * Google caps `size` at 640 per axis, so a frame wider than that at the zoom you want has to
 * be fetched as several images and stitched. That is the ONLY way to get both the operator's
 * exact frame and more detail than one request allows — widening the frame to fill the budget
 * was tried and reverted, because it fills the extra pixels with more ground rather than more
 * detail (see the note below).
 *
 * One zoom deeper than the single-request fit, so 2x the linear detail, whenever that costs
 * MAX_TILES requests or fewer. Otherwise a single request, which is the same code path with a
 * 1x1 grid.
 */
function planTiles(bounds: LatLngBox): RenderPlan {
  const { spanX, spanY, center } = mercatorSpan(bounds);

  // The largest integer zoom at which the whole frame fits one request.
  let base = MAX_ZOOM;
  while (
    base > 1 &&
    (spanX * 2 ** base > MAX_STATIC_DIMENSION ||
      spanY * 2 ** base + ATTRIBUTION_PAD_PX > MAX_STATIC_DIMENSION)
  ) {
    base -= 1;
  }

  // ⚠️ Do NOT widen the frame to spend the rest of the 640px budget at `base`. Integer zoom
  // levels leave the frame between 320 and 640px, so up to 38% goes unused — but scaling the
  // frame up at the same zoom fills that with MORE GROUND, because metres-per-pixel is fixed
  // by the zoom. The export then stops showing what the operator framed, which is a worse
  // fault than a small image. Tried and reverted on 2026-09-07. Tiling is the answer instead.
  const plan = (zoom: number): RenderPlan | null => {
    const at = 2 ** zoom;
    // Even, so the boundary splits below stay on whole pixels.
    const width = 2 * Math.ceil((spanX * at) / 2);
    const height = 2 * Math.ceil((spanY * at + ATTRIBUTION_PAD_PX) / 2);
    // Every tile but the bottom-left is fetched TILE_BAND_CROP_PX taller and cropped, so its
    // usable height is capped below 640 by that much.
    const cols = Math.ceil(width / MAX_STATIC_DIMENSION);
    const rows = Math.ceil(height / (MAX_STATIC_DIMENSION - TILE_BAND_CROP_PX));
    if (cols * rows > MAX_TILES) return null;

    const xs = evenBoundaries(width, cols);
    const bottomXs = attributionBiasedBoundaries(width, cols);
    const ys = evenBoundaries(height, rows);
    const tiles: TileRect[] = [];
    for (let r = 0; r < rows; r++) {
      const bottom = r === rows - 1;
      const rowXs = bottom ? bottomXs : xs;
      for (let c = 0; c < cols; c++) {
        tiles.push({
          x: rowXs[c],
          y: ys[r],
          width: rowXs[c + 1] - rowXs[c],
          height: ys[r + 1] - ys[r],
          // The bottom-left tile keeps Google's bar exactly where Google drew it, over the
          // frame's own bottom-left — which the ATTRIBUTION_PAD_PX strip makes sure is
          // spare ground rather than a measurement. Every other tile's bar is cropped, so
          // the composite carries ONE unmodified Google attribution instead of one per tile.
          // Nothing is redrawn: the provider list ("Airbus, CNES / Airbus, Landsat /
          // Copernicus…") arrives as pixels, not data, so it cannot be reproduced by hand.
          keepsAttribution: bottom && c === 0,
        });
      }
    }
    return { zoom, width, height, center, tiles, ui: 2 ** (zoom - base) };
  };

  return (base < MAX_ZOOM ? plan(base + 1) : null) ?? plan(base)!;
}

/**
 * Text, with "²" rendered as a raised, smaller "2".
 *
 * The glyph atlas is printable ASCII only, so "m²" would otherwise come out as "m?" —
 * and "1,234 m?" in a client-facing drawing is worse than no legend at all. Superscripting
 * a real digit is both correct and the only option that doesn't need a new atlas.
 */
const SUPER_SCALE = 0.62;
const SUPER_RISE = 0.36;

function textWithSuper(text: string, x: number, y: number, fontSize: number, fill: string): string {
  const parts: string[] = [];
  let penX = x;
  let run = "";
  const flush = () => {
    if (!run) return;
    parts.push(textToSvgPaths(run, { x: penX, y, fontSize, fill }));
    penX += textWidth(run, fontSize);
    run = "";
  };
  for (const char of text) {
    if (char === "²") {
      flush();
      const size = fontSize * SUPER_SCALE;
      parts.push(textToSvgPaths("2", { x: penX, y: y - fontSize * SUPER_RISE, fontSize: size, fill }));
      penX += textWidth("2", size);
      continue;
    }
    run += char;
  }
  flush();
  return parts.join("\n    ");
}

function widthWithSuper(text: string, fontSize: number): number {
  let total = 0;
  for (const char of text) {
    total += char === "²" ? textWidth("2", fontSize * SUPER_SCALE) : textWidth(char, fontSize);
  }
  return total;
}

interface Row {
  index: number;
  value: string;
}

/** One row per drawn shape — its badge number and its area, nothing else — plus a total.
 *
 *  Deliberately no mode/width/length column. The number ties the row to the badge on the
 *  imagery, the area is what the drawing exists to communicate, and every extra column was
 *  widening the panel over the very map it was describing. Width and length stay on screen
 *  in the tool's own panel. */
function rowsFor(measurements: (Measurable & { id: string })[]): { rows: Row[]; totalSqm: number } {
  const rows: Row[] = [];
  let totalSqm = 0;
  measurements.forEach((m, i) => {
    if (m.points.length < MIN_POINTS[m.mode]) return;
    const measured = measureShape(m);
    totalSqm += measured.areaSqm;
    rows.push({ index: i + 1, value: formatArea(measured.areaSqm) });
  });
  return { rows, totalSqm };
}

const PANEL_PAD = 18;
const ROW_HEIGHT = 30;
const ROW_SIZE = 19;
/** Badge radius in OUTPUT pixels. Small on purpose: at a wide zoom a 10m ribbon is barely
 *  2-3 output px across, so the badge is an order of magnitude wider than the thing it
 *  labels and any bigger simply erases it. */
const BADGE_R = 12;
/** Enough to clear a thin ribbon's centreline entirely. A wide ribbon at a close zoom is
 *  broad enough to host the badge anyway, so this only ever helps. */
const BADGE_CLEARANCE = 4;
/** Translucent, so whatever it lands on still reads through it. */
const BADGE_FILL_OPACITY = 0.82;
/** Between the number column and the area column. A readable separation and nothing more —
 *  see legendSvg() for why this alone didn't control the gap. */
const GAP = 16;

function legendSvg(rows: Row[], totalSqm: number, showTotal: boolean): string {
  const x = 20;
  const y = 20;
  const totalLabel = "Total";
  const totalValue = formatArea(totalSqm);

  const values = rows.map((r) => r.value).concat(showTotal ? [totalValue] : []);
  const valueColumn = Math.max(...values.map((v) => widthWithSuper(v, ROW_SIZE)));
  // The widest number actually present, not a reserved "99" — with three measurements the
  // column has no business being two digits wide.
  const numberColumn = Math.max(...rows.map((r) => textWidth(String(r.index), ROW_SIZE)));
  const labelColumn = Math.max(numberColumn, showTotal ? textWidth(totalLabel, ROW_SIZE) : 0);

  const contentWidth = labelColumn + GAP + valueColumn;
  const bodyRows = rows.length + (showTotal ? 1 : 0);
  const width = PANEL_PAD * 2 + contentWidth;
  const height = PANEL_PAD * 2 + bodyRows * ROW_HEIGHT - (ROW_HEIGHT - ROW_SIZE);
  const right = x + width - PANEL_PAD;
  // Numbers are RIGHT-aligned to the label column's edge, so the space between a number
  // and its area is exactly GAP on every row. Left-aligning them instead put the gap at
  // the mercy of the widest LEFT item: "Total" is 45px against a 10px "1", and with the
  // areas right-aligned to the panel edge that difference showed up as 75px of dead space
  // between "1" and its figure — on a panel 162px wide. Any empty space now sits to the
  // LEFT of the numbers, where it reads as padding and the Total row fills it anyway.
  const numberRight = x + PANEL_PAD + labelColumn;

  const lines: string[] = [
    `<rect x="${x}" y="${y}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="10" fill="white" fill-opacity="0.93" stroke="#cccccc" stroke-width="1.5" />`,
  ];

  let rowY = y + PANEL_PAD + ROW_SIZE;
  for (const row of rows) {
    const label = String(row.index);
    lines.push(
      textToSvgPaths(label, {
        x: numberRight - textWidth(label, ROW_SIZE),
        y: rowY,
        fontSize: ROW_SIZE,
        fill: SHAPE_COLOR,
      }),
      textWithSuper(row.value, right - widthWithSuper(row.value, ROW_SIZE), rowY, ROW_SIZE, INK)
    );
    rowY += ROW_HEIGHT;
  }

  if (showTotal) {
    const ruleY = (rowY - ROW_SIZE - 8).toFixed(1);
    lines.push(
      `<line x1="${x + PANEL_PAD}" y1="${ruleY}" x2="${right}" y2="${ruleY}" stroke="#dddddd" stroke-width="1.5" />`,
      textToSvgPaths(totalLabel, {
        x: numberRight - textWidth(totalLabel, ROW_SIZE),
        y: rowY,
        fontSize: ROW_SIZE,
        fill: MUTED,
      }),
      textWithSuper(totalValue, right - widthWithSuper(totalValue, ROW_SIZE), rowY, ROW_SIZE, STEEL)
    );
  }

  return lines.filter(Boolean).join("\n    ");
}

/** Top-right compass. Static Maps is always rendered north-up here — no `heading` is ever
 *  sent — so this is a fixed icon with no orientation maths. */
function northArrowSvg(canvasWidth: number): string {
  const r = 32;
  const cx = canvasWidth - 20 - r;
  const cy = 20 + r;
  const LABEL_SIZE = 20;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" fill-opacity="0.95" stroke="#${STEEL}" stroke-width="2.5" />
    <polygon points="${cx},${cy - 18} ${cx - 10},${cy - 2} ${cx + 10},${cy - 2}" fill="#${STEEL}" />
    ${textToSvgPaths("N", {
      x: cx - textWidth("N", LABEL_SIZE) / 2,
      y: cy + 25,
      fontSize: LABEL_SIZE,
      fill: STEEL,
    })}`;
}

/** The numbered badge on each shape — the only thing tying a legend row to a shape on the
 *  imagery. Unlike the Building Markup tab, which strips its numbered pins from the client
 *  download, these have to be baked: without them the legend is a list of anonymous areas. */
function badgesSvg(
  measurements: (Measurable & { id: string })[],
  center: LatLng,
  zoom: number,
  /** LOGICAL size — the Static Maps `size`, before `scale`. */
  width: number,
  height: number,
  /** The overlay is authored at 1x and scaled as a group, so divide positions by this. */
  ui: number
): string {
  const projection = { center, zoom, imageSizePx: width, imageHeightPx: height };
  // latLngToPixel works in the pre-`scale` pixel space Static Maps' own `size` describes,
  // so its result has to be multiplied up to the actual image. Handing it the scaled size
  // instead lands every offset at exactly half the right distance — which reads as a
  // plausible-but-wrong position, not a bug.
  const toOutput = (p: LatLng) => {
    const logical = latLngToPixel(projection, p);
    return { x: (logical.x * SCALE) / ui, y: (logical.y * SCALE) / ui };
  };
  const outWidth = (width * SCALE) / ui;
  const outHeight = (height * SCALE) / ui;

  const parts: string[] = [];
  measurements.forEach((m, i) => {
    if (m.points.length < MIN_POINTS[m.mode]) return;
    const ring = ringFor(m);
    if (ring.length < 3) return;

    const centre = toOutput(centroidOf(ring));
    let at = centre;

    // A LINE's ribbon centroid sits ON the ribbon, and at any zoom wide enough to hold a
    // whole road the ribbon is thinner than the badge — so the badge erased the very shape
    // it was labelling. Nudge it perpendicular to the run of the line instead. An AREA is
    // broad enough to carry the badge in the middle of it, which is also where it reads
    // best, so it stays put.
    if (m.mode === "line") {
      const first = toOutput(m.points[0]);
      const last = toOutput(m.points[m.points.length - 1]);
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      const len = Math.hypot(dx, dy);
      if (len > 0.001) {
        const offset = BADGE_R + BADGE_CLEARANCE;
        const nudged = { x: centre.x - (dy / len) * offset, y: centre.y + (dx / len) * offset };
        // Only take the nudge if it stays in frame — better a badge sitting on its line
        // than one pushed off the edge and dropped, which would leave a legend row with
        // nothing on the map to match it to.
        const margin = BADGE_R + 2;
        if (
          nudged.x > margin &&
          nudged.y > margin &&
          nudged.x < outWidth - margin &&
          nudged.y < outHeight - margin
        ) {
          at = nudged;
        }
      }
    }

    // Off-frame badges are dropped rather than clamped to the edge, which would point at
    // the wrong place on the ground.
    if (at.x < 0 || at.y < 0 || at.x > outWidth || at.y > outHeight) return;

    const label = String(i + 1);
    parts.push(
      `<circle cx="${at.x.toFixed(1)}" cy="${at.y.toFixed(1)}" r="${BADGE_R}" fill="#${SHAPE_COLOR}" fill-opacity="${BADGE_FILL_OPACITY}" stroke="white" stroke-opacity="0.9" stroke-width="2" />`,
      textToSvgPaths(label, {
        x: at.x - textWidth(label, 15) / 2,
        y: at.y + 5.4,
        fontSize: 15,
        fill: "ffffff",
      })
    );
  });
  return parts.join("\n    ");
}

export interface MeasureExportResult {
  imageBase64: string;
  widthPx: number;
  heightPx: number;
}

/** Static Maps caps a request URL around 8192 chars. A dozen 100-point measurements buffer
 *  into rings of ~200 vertices each, which blows that even encoded — so simplify until it
 *  fits rather than let the fetch 414. Tolerances are in metres; 1.5m is invisible at any
 *  zoom this export runs at. */
const URL_LENGTH_BUDGET = 7600;
const SIMPLIFY_TOLERANCES_M = [0, 0.3, 1.5, 5];

function polygonsFor(measurements: (Measurable & { id: string })[], toleranceMetres: number) {
  return measurements
    .filter((m) => m.points.length >= MIN_POINTS[m.mode])
    .map((m) => {
      const ring = ringFor(m);
      return {
        ring: toleranceMetres > 0 ? simplifyRing(ring, toleranceMetres) : ring,
        fillColor: SHAPE_COLOR,
        fillOpacityPercent: FILL_OPACITY_PERCENT,
        strokeColor: SHAPE_COLOR,
        strokeOpacityPercent: STROKE_OPACITY_PERCENT,
        strokeWeight: OUTLINE_WEIGHT,
      };
    })
    .filter((p) => p.ring.length >= 3);
}

export async function renderMeasureExport(input: MeasureExportInput): Promise<MeasureExportResult> {
  const plan = planTiles(input.bounds);
  const frame = {
    center: plan.center,
    zoom: plan.zoom,
    imageSizePx: plan.width,
    imageHeightPx: plan.height,
  };

  const tileUrl = (tile: TileRect, tolerance: number) => {
    // Every tile except the bottom-left is fetched taller than it needs and cropped, so its
    // requested centre has to account for the extra band — otherwise the kept top portion
    // shows ground half a band north of where it belongs.
    const requestHeight = tile.height + (tile.keepsAttribution ? 0 : TILE_BAND_CROP_PX);
    const centre = pixelToLatLng(frame, {
      x: tile.x + tile.width / 2,
      y: tile.y + requestHeight / 2,
    });
    return {
      requestHeight,
      url: buildStaticMapUrl({
        mapType: input.mapType,
        // A pinned frame with no adjust — every tile must land exactly where planned.
        frame: { center: centre, fitZoom: plan.zoom },
        zoomAdjust: 0,
        size: { width: tile.width, height: requestHeight },
        // The same shapes go to every tile; Google draws whatever falls inside each
        // viewport, so a ribbon crossing a seam is continuous once stitched.
        polygons: polygonsFor(input.measurements, tolerance),
        styles: ["feature:poi|visibility:off"],
      }).url,
    };
  };

  // One tolerance for all tiles, chosen off the longest URL any of them would produce —
  // different tiles simplifying differently would break a shape at a seam.
  const tolerance =
    SIMPLIFY_TOLERANCES_M.find((t) =>
      plan.tiles.every((tile) => tileUrl(tile, t).url.length <= URL_LENGTH_BUDGET)
    ) ?? SIMPLIFY_TOLERANCES_M[SIMPLIFY_TOLERANCES_M.length - 1];

  const pxWidth = plan.width * SCALE;
  const pxHeight = plan.height * SCALE;

  const layers = await Promise.all(
    plan.tiles.map(async (tile) => {
      const { url, requestHeight } = tileUrl(tile, tolerance);
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Google Static Maps request failed (${res.status}). ${text.slice(0, 200)}`);
      }
      const raw = Buffer.from(await res.arrayBuffer());
      // Crop Google's attribution bar off. Only the bottom-left tile keeps its own, so the
      // stitched image carries exactly one — see planTiles.
      const bytes =
        requestHeight === tile.height
          ? raw
          : await sharp(raw)
              .extract({ left: 0, top: 0, width: tile.width * SCALE, height: tile.height * SCALE })
              .png()
              .toBuffer();
      return { input: bytes, left: tile.x * SCALE, top: tile.y * SCALE };
    })
  );

  const stitched = await sharp({
    create: {
      width: pxWidth,
      height: pxHeight,
      channels: 3,
      // Only ever visible if a tile fetch silently returned something short.
      background: { r: 24, g: 26, b: 28 },
    },
  })
    .composite(layers)
    .png()
    .toBuffer();

  const { rows, totalSqm } = rowsFor(input.measurements);

  // The overlay is authored at 1x and scaled as a group, so one factor keeps the legend,
  // badges and compass the same size RELATIVE to the map however many tiles were stitched.
  const overlay = Buffer.from(
    `<svg width="${pxWidth}" height="${pxHeight}" xmlns="http://www.w3.org/2000/svg">
    <g transform="scale(${plan.ui})">
      ${badgesSvg(input.measurements, plan.center, plan.zoom, plan.width, plan.height, plan.ui)}
      ${rows.length > 0 ? legendSvg(rows, totalSqm, rows.length > 1) : ""}
      ${northArrowSvg(pxWidth / plan.ui)}
    </g>
  </svg>`
  );

  const composed = await sharp(stitched)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return { imageBase64: composed.toString("base64"), widthPx: pxWidth, heightPx: pxHeight };
}
