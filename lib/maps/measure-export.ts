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
import { latLngToPixel, type LatLngBox } from "@/lib/kml/standard-markup/projection";
import {
  FILL_OPACITY_PERCENT,
  OUTLINE_WEIGHT,
  SHAPE_COLORS,
  STROKE_OPACITY_PERCENT,
} from "@/lib/kml/standard-markup/style";
import { GoogleMapsConfigError, SCALE } from "@/lib/kml/site-markup/static-map";
import { renderTiledStaticMap } from "./static-map-tiles";
import { textToSvgPaths, textWidth } from "@/lib/kml/overlay/text-path";
import {
  INK,
  MUTED,
  NUM_GAP,
  PANEL_PAD,
  ROW_HEIGHT,
  ROW_SIZE,
  TOTAL_GAP,
  UNIT_GAP,
  panelRect,
  splitValue,
  textWithSuper,
  widthWithSuper,
} from "@/lib/kml/overlay/legend";

export { GoogleMapsConfigError };
/** One flat colour for every shape, unlike the live map's steel/orange selected split —
 *  an exported still has no notion of "selected", and orange is what reads over grass,
 *  bitumen and a tin roof alike. Same value the Building Markup shapes and the Road
 *  Markup line already use. */
const SHAPE_COLOR = SHAPE_COLORS.orange;
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

/** Badge radius in OUTPUT pixels. Small on purpose: at a wide zoom a 10m ribbon is barely
 *  2-3 output px across, so the badge is an order of magnitude wider than the thing it
 *  labels and any bigger simply erases it. */
const BADGE_R = 12;
/** Enough to clear a thin ribbon's centreline entirely. A wide ribbon at a close zoom is
 *  broad enough to host the badge anyway, so this only ever helps. */
const BADGE_CLEARANCE = 4;
/** Translucent, so whatever it lands on still reads through it. */
const BADGE_FILL_OPACITY = 0.82;


/**
 * The legend: a three-column table — badge number, figures, unit.
 *
 * Numbers right-align to the label column's edge and figures right-align to their own, so
 * the ones place lines up down the column and the units sit flush beside it. Everything is
 * measured from real glyph widths rather than constants, so changing the copy can't silently
 * clip it.
 */
function legendSvg(rows: Row[], totalSqm: number, showTotal: boolean): string {
  const x = 20;
  const y = 20;
  const totalLabel = "Total";
  const parsed = rows.map((r) => ({ index: String(r.index), ...splitValue(r.value) }));
  const total = splitValue(formatArea(totalSqm));

  const labelColumn = Math.max(
    ...parsed.map((r) => textWidth(r.index, ROW_SIZE)),
    showTotal ? textWidth(totalLabel, ROW_SIZE) : 0
  );
  const digitsColumn = Math.max(
    ...parsed.map((r) => textWidth(r.digits, ROW_SIZE)),
    showTotal ? textWidth(total.digits, ROW_SIZE) : 0
  );
  const unitColumn = Math.max(
    ...parsed.map((r) => widthWithSuper(r.unit, ROW_SIZE)),
    showTotal ? widthWithSuper(total.unit, ROW_SIZE) : 0
  );

  const contentWidth = labelColumn + NUM_GAP + digitsColumn + UNIT_GAP + unitColumn;
  const width = PANEL_PAD * 2 + contentWidth;
  const height =
    PANEL_PAD * 2 + (rows.length - 1) * ROW_HEIGHT + ROW_SIZE + (showTotal ? ROW_HEIGHT + TOTAL_GAP : 0);

  const labelRight = x + PANEL_PAD + labelColumn;
  const digitsRight = labelRight + NUM_GAP + digitsColumn;
  const unitLeft = digitsRight + UNIT_GAP;

  const row = (
    label: string,
    labelFill: string,
    digits: string,
    unit: string,
    valueFill: string,
    baseline: number
  ) =>
    [
      textToSvgPaths(label, {
        x: labelRight - textWidth(label, ROW_SIZE),
        y: baseline,
        fontSize: ROW_SIZE,
        fill: labelFill,
      }),
      textToSvgPaths(digits, {
        x: digitsRight - textWidth(digits, ROW_SIZE),
        y: baseline,
        fontSize: ROW_SIZE,
        fill: valueFill,
      }),
      textWithSuper(unit, unitLeft, baseline, ROW_SIZE, valueFill),
    ].join("\n    ");

  const lines: string[] = [panelRect(x, y, width, height)];

  let baseline = y + PANEL_PAD + ROW_SIZE;
  for (const r of parsed) {
    // The number is the only colour in here, because it is the one thing that has to be
    // matched against the badge on the map.
    lines.push(row(r.index, SHAPE_COLOR, r.digits, r.unit, INK, baseline));
    baseline += ROW_HEIGHT;
  }

  if (showTotal) {
    baseline += TOTAL_GAP;
    const ruleY = (baseline - ROW_SIZE - TOTAL_GAP + 1).toFixed(1);
    lines.push(
      `<line x1="${x + PANEL_PAD}" y1="${ruleY}" x2="${(x + width - PANEL_PAD).toFixed(1)}" y2="${ruleY}" stroke="rgba(0,0,0,0.14)" stroke-width="1" />`,
      row(totalLabel, MUTED, total.digits, total.unit, INK, baseline)
    );
  }

  return lines.join("\n    ");
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
  // Tiling, fetching and stitching all live in lib/maps/static-map-tiles.ts, shared with the
  // Building Markup export. Unchanged behaviour — it was extracted from here verbatim.
  const { stitched, plan, pxWidth, pxHeight } = await renderTiledStaticMap({
    bounds: input.bounds,
    mapType: input.mapType,
    polygonsFor: (tolerance) => polygonsFor(input.measurements, tolerance),
    styles: ["feature:poi|visibility:off"],
  });

  const { rows, totalSqm } = rowsFor(input.measurements);

  // The overlay is a FIXED pixel size, deliberately not scaled with the tile count.
  //
  // It was scaled at first, to keep a badge and a legend row the same size relative to the
  // map. But "relative to the map" means relative to the ground, and a 2x-detail export
  // covers the same ground in twice the pixels — so the legend came out at 38px text on a
  // 2024px image, which just reads as oversized. A legend, a compass and a badge are chrome:
  // they want to be legible on the final image, not proportional to metres. Google's own
  // attribution is fixed for the same reason, and so is the shapes' OUTLINE_WEIGHT.
  const overlay = Buffer.from(
    `<svg width="${pxWidth}" height="${pxHeight}" xmlns="http://www.w3.org/2000/svg">
    ${badgesSvg(input.measurements, plan.center, plan.zoom, plan.width, plan.height)}
    ${rows.length > 0 ? legendSvg(rows, totalSqm, rows.length > 1) : ""}
    ${northArrowSvg(pxWidth)}
  </svg>`
  );

  const composed = await sharp(stitched)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return { imageBase64: composed.toString("base64"), widthPx: pxWidth, heightPx: pxHeight };
}
