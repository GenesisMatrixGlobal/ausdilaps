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
import { centroidOf } from "@/lib/kml/standard-markup/geometry";
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
const ATTRIBUTION_PAD_PX = 18;

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

/**
 * Picks the Static Maps centre, integer zoom and size that frame exactly the given bounds.
 *
 * Coverage at a zoom is a function of the image's size in Static Maps "points", and those
 * are capped at 640 per axis — while the live map is routinely 1100+ CSS px wide. So take
 * the largest integer zoom at which the box still fits inside 640, and request precisely
 * the size the box occupies at that zoom. `scale: 2` then doubles the pixel output, so the
 * file lands near on-screen dimensions at half the ground resolution.
 */
function fitToBounds(bounds: LatLngBox) {
  const { spanX, spanY, center } = mercatorSpan(bounds);
  const clamp = (n: number) => Math.max(1, Math.min(MAX_STATIC_DIMENSION, Math.round(n)));

  // The largest integer zoom at which the live view PLUS the attribution strip still fits
  // inside Google's 640-per-axis cap. Stepping down rather than solving for it directly
  // because the pad is a constant in pixels, not a fraction of the span.
  let zoom = MAX_ZOOM;
  while (
    zoom > 1 &&
    (spanX * 2 ** zoom > MAX_STATIC_DIMENSION ||
      spanY * 2 ** zoom + ATTRIBUTION_PAD_PX > MAX_STATIC_DIMENSION)
  ) {
    zoom -= 1;
  }

  const at = 2 ** zoom;
  const mapWidth = spanX * at;
  const mapHeight = spanY * at;

  // Spend the WHOLE 640 budget, by widening the geographic frame at the same zoom until the
  // limiting axis hits the cap.
  //
  // Integer zoom levels otherwise leave up to 38% of the resolution unused: the zoom chosen
  // above is the largest that fits, so the next one up would have needed more than 640 —
  // which means the frame occupies somewhere between 320 and 640 px and the rest of the
  // budget is simply thrown away. A real export came out 790x494 for want of this.
  //
  // Note what this does and does not do. The image gets bigger (up to just under 2x
  // linearly) and Google's fixed-size attribution therefore covers a proportionally smaller
  // part of it. Ground DETAIL is unchanged — same zoom, same metres per pixel — so the
  // export is not sharper, it shows more surrounding context at the same crispness. Real
  // extra detail needs a deeper zoom, which exceeds the cap and would mean stitching
  // several requests.
  const fill = Math.max(
    1,
    Math.min(
      mapWidth > 0 ? MAX_STATIC_DIMENSION / mapWidth : 1,
      mapHeight > 0 ? (MAX_STATIC_DIMENSION - ATTRIBUTION_PAD_PX) / mapHeight : 1
    )
  );

  const width = clamp(mapWidth * fill);
  const height = clamp(mapHeight * fill + ATTRIBUTION_PAD_PX);

  // Move the centre SOUTH by half the pad so all the extra ground lands at the BOTTOM,
  // under the attribution, rather than being split evenly top and bottom. Done by
  // re-projecting through pixelToLatLng so the Mercator maths stays in one place.
  const center2 = pixelToLatLng(
    { center, zoom, imageSizePx: width, imageHeightPx: height },
    { x: width / 2, y: height / 2 + ATTRIBUTION_PAD_PX / 2 }
  );

  return { center: center2, zoom, width, height };
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
function northArrowSvg(imageWidth: number): string {
  const r = 32;
  const cx = imageWidth - 20 - r;
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
  height: number
): string {
  const projection = { center, zoom, imageSizePx: width, imageHeightPx: height };
  // latLngToPixel works in the pre-`scale` pixel space Static Maps' own `size` describes,
  // so its result has to be multiplied up to the actual image. Handing it the scaled size
  // instead lands every offset at exactly half the right distance — which reads as a
  // plausible-but-wrong position, not a bug.
  const toOutput = (p: LatLng) => {
    const logical = latLngToPixel(projection, p);
    return { x: logical.x * SCALE, y: logical.y * SCALE };
  };
  const outWidth = width * SCALE;
  const outHeight = height * SCALE;

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

export async function renderMeasureExport(input: MeasureExportInput): Promise<MeasureExportResult> {
  const fitted = fitToBounds(input.bounds);

  const drawable = input.measurements.filter((m) => m.points.length >= MIN_POINTS[m.mode]);
  const { rows, totalSqm } = rowsFor(input.measurements);

  const { url } = buildStaticMapUrl({
    mapType: input.mapType,
    // A pinned frame with no adjust — the export must show what was on screen, not refit
    // itself to the geometry.
    frame: { center: fitted.center, fitZoom: fitted.zoom },
    zoomAdjust: 0,
    size: { width: fitted.width, height: fitted.height },
    polygons: drawable.map((m) => ({
      ring: ringFor(m),
      fillColor: SHAPE_COLOR,
      fillOpacityPercent: FILL_OPACITY_PERCENT,
      strokeColor: SHAPE_COLOR,
      strokeOpacityPercent: STROKE_OPACITY_PERCENT,
      strokeWeight: OUTLINE_WEIGHT,
    })),
    styles: ["feature:poi|visibility:off"],
  });

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Static Maps request failed (${res.status}). ${text.slice(0, 200)}`);
  }

  // The overlay is authored in the image's ACTUAL pixel space (size x scale), so a stroke
  // width or a font size means the same thing here as it does in the panel.
  const pxWidth = fitted.width * SCALE;
  const pxHeight = fitted.height * SCALE;
  const overlay = Buffer.from(
    `<svg width="${pxWidth}" height="${pxHeight}" xmlns="http://www.w3.org/2000/svg">
    ${badgesSvg(input.measurements, fitted.center, fitted.zoom, fitted.width, fitted.height)}
    ${rows.length > 0 ? legendSvg(rows, totalSqm, rows.length > 1) : ""}
    ${northArrowSvg(pxWidth)}
  </svg>`
  );

  const composed = await sharp(Buffer.from(await res.arrayBuffer()))
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return { imageBase64: composed.toString("base64"), widthPx: pxWidth, heightPx: pxHeight };
}
