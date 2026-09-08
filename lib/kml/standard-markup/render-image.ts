// Shared "turn resolved geometry into a PNG" step for Standard Mark Up — used by both
// the initial full-resolve route and the lightweight re-render route (which re-draws
// after the user excludes a neighbour lot, without repeating the geocode/cadastre/
// Overpass work). Kept separate from resolve.ts so the render-only route never needs
// to import the geocoding/ArcGIS machinery.

import sharp from "sharp";
import type { LatLng } from "@/lib/kml/types";
import {
  GoogleMapsConfigError,
  SCALE,
  type StaticMapPolygon,
} from "@/lib/kml/site-markup/static-map";
import { renderTiledStaticMap } from "@/lib/maps/static-map-tiles";
import { textToSvgPaths, textToSvgPathsCentred, textWidth } from "@/lib/kml/overlay/text-path";
import {
  HAIRLINE,
  INK,
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
import { badgeAnchor, formatArea, measureShape, ringAnchor, ringFor } from "./measure";
import { lotPlanFromId } from "./parcels/parcel-id";
import { COMPASS_N_PATH, LEGEND_LABEL_PATHS, LEGEND_LABEL_WIDTHS } from "./overlay-paths";
import { latLngToPixel, type LatLngBox } from "./projection";
import {
  FILL_OPACITY_PERCENT,
  NEIGHBOUR_FILL,
  OUTLINE_WEIGHT,
  SHAPE_COLORS,
  SITE_RED,
  SITE_STROKE_OPACITY_PERCENT,
  STROKE_OPACITY_PERCENT,
} from "./style";
import { bufferLineToPolygon, centroidOf, closeRing, simplifyRing } from "./geometry";

export { GoogleMapsConfigError };

export interface MarkupShapeInput {
  points: LatLng[];
  /** Ignored when `mode` is "area". */
  widthMetres: number;
  /** "line" buffers the points into a ribbon `widthMetres` wide (a frontage, a footpath);
   *  "area" closes them into the shape they trace and infills it (a nature strip, a
   *  reserve, a building footprint). Both end up as ordinary entries in the same Static
   *  Maps polygon list. */
  mode: "line" | "area";
  color: keyof typeof SHAPE_COLORS;
  /** Badge number, assigned client-side over the ticked sheet rows. */
  label?: string;
  /** What the operator called it on the sheet, for the legend. */
  name?: string;
}

const MAX_NEIGHBOURS = 12;

/** Only what DRAWING a neighbour needs, rather than everything resolve.ts knows about one:
 *  the renderer has no use for a street address, and extending the full interface made a
 *  /render caller (which reconstructs neighbours from the client's payload) responsible for
 *  round-tripping fields it never had. */
export interface NumberedNeighbour {
  id: string;
  ring: LatLng[];
  areaSqm: number | null;
  /** The quote item number, or "" for a lot that is DRAWN but is not a line item. Assigned on
   *  the client over the ticked sheet rows, so the bubble, the sheet and this legend agree.
   *  Empty means: draw the outline, no bubble, no legend row. */
  label: string;
  /** From the state address layer — what the legend names this lot. Optional: a lot the layer
   *  had nothing for simply falls back to its lot/plan. */
  street?: string | null;
}

/** Assigns each neighbour a stable display number, in the order given — call this once,
 *  right after resolving, and keep the labels attached for every later re-render so a
 *  lot's number never changes as others get excluded.
 *
 *  The label is drawn by the CLIENT, as an SVG bubble in the markup overlay, not baked
 *  into the PNG here. That's deliberate: the overlay sits above the map image, so a bubble
 *  drawn there stays on top of any custom shape, and unticking a lot removes it with no
 *  round trip. Don't reintroduce Static Maps `markers` for these — you'd get two sets. */
export interface RenderMapInput {
  subjectRing: LatLng[];
  /** All neighbours to consider — already numbered; `excludeIds` is applied here, not by
   *  the caller. */
  neighbours: NumberedNeighbour[];
  mapType: "satellite" | "hybrid" | "roadmap";
  excludeIds?: string[];
  /** Drops the cadastre-derived red project-site boundary, for when it's wrong and the
   *  operator has redrawn it as a red shape instead. */
  hideSubject?: boolean;
  /** User-drawn shapes (click-to-place points, each a line or an area) — a list, not one,
   *  since a property can need several unrelated ones (e.g. a front road frontage and an
   *  adjacent building). */
  shapes?: MarkupShapeInput[];
  /**
   * The frame to render: exactly what the live map had on screen.
   *
   * Bounds, not centre+zoom. This replaced a pinned `frame` + a −3…+3 `zoomAdjust` when the
   * tab moved to a live Maps JS map, which has FRACTIONAL zoom (17.5 is a real state) while
   * Static Maps accepts integers only — rounding one would shift the frame by up to 40% of
   * its area. A box is unambiguous at any zoom, and it also retired the whole pinned-frame
   * apparatus (boundsAnchor, subjectAnchors, fitZoom and the re-fit rules that grew around
   * them), because the operator now points the camera themselves.
   */
  bounds: LatLngBox;
  /** The subject's own street and area, for the legend's project-site row. */
  subjectStreet?: string | null;
  subjectAreaSqm?: number | null;
  /** The site's quote item number, or "" when it is drawn but not a line item — which is the
   *  usual case, since the site is normally shown to the client rather than billed. */
  subjectLabel?: string;
}

export interface RenderMapResult {
  imageBase64: string;
  flags: string[];
  widthPx: number;
  heightPx: number;
}

/**
 * Every polygon the export draws, at the given simplification tolerance.
 *
 * Static Maps caps a request URL around 8192 chars and the same rings go to every tile, so
 * the tolerance is chosen by the shared renderer from the longest URL any tile would produce.
 */
function markupPolygons(
  subjectRing: LatLng[],
  kept: NumberedNeighbour[],
  shapes: MarkupShapeInput[],
  hideSubject: boolean,
  tolerance: number
): StaticMapPolygon[] {
  // An area needs 3 points to enclose anything; a line needs 2 to have a direction to
  // buffer perpendicular to. Anything short of that yields an empty ring and is dropped, so
  // a half-drawn shape simply doesn't render rather than erroring the whole map.
  const shapePolygons = shapes
    .map((sh) => ({
      ring:
        sh.mode === "area"
          ? sh.points.length >= 3
            ? closeRing(sh.points)
            : []
          : bufferLineToPolygon(sh.points, sh.widthMetres),
      color: SHAPE_COLORS[sh.color] ?? SHAPE_COLORS.orange,
    }))
    .filter((p) => p.ring.length >= 3);

  const simplify = (ring: LatLng[]) => (tolerance > 0 ? simplifyRing(ring, tolerance) : ring);

  return [
    // The subject property — red-lined per the standard building-inspection site marking
    // convention, and the only thing drawn at full stroke opacity.
    ...(hideSubject
      ? []
      : [
          {
            ring: simplify(subjectRing),
            fillColor: SITE_RED,
            fillOpacityPercent: FILL_OPACITY_PERCENT,
            strokeColor: SITE_RED,
            strokeOpacityPercent: SITE_STROKE_OPACITY_PERCENT,
            strokeWeight: OUTLINE_WEIGHT,
          },
        ]),
    ...kept.map((n) => ({
      ring: simplify(n.ring),
      fillColor: NEIGHBOUR_FILL,
      fillOpacityPercent: FILL_OPACITY_PERCENT,
      strokeColor: NEIGHBOUR_FILL,
      strokeOpacityPercent: STROKE_OPACITY_PERCENT,
      strokeWeight: OUTLINE_WEIGHT,
    })),
    ...shapePolygons.map(({ ring, color }) => ({
      ring: simplify(ring),
      fillColor: color,
      fillOpacityPercent: FILL_OPACITY_PERCENT,
      strokeColor: color,
      strokeOpacityPercent: STROKE_OPACITY_PERCENT,
      strokeWeight: OUTLINE_WEIGHT,
    })),
  ].filter((p) => p.ring.length >= 3);
}

/**
 * The numbered pins, baked into the export.
 *
 * These used to exist ONLY in the on-screen overlay — the exported PNG carried the legend,
 * the north arrow and the coloured outlines, and nothing to say which lot was which. That was
 * tolerable while the numbers were a screen-only aid, but the Quote Line Item sheet labels its
 * rows "Lot 1 … Lot n", so a PNG filed against a quote has to be readable against it.
 *
 * Drawn in the sharp composite rather than as Static Maps `markers`, for two reasons: a
 * `markers` param belongs to ONE tile's request, not to the stitched frame, so a pin near a
 * seam would be missing or duplicated; and drawing it here keeps it identical to what
 * map-badge.ts puts on the live map — teardrops for lots, circles in the shape's own colour
 * for hand-drawn shapes, so the two independent number series can't be confused.
 */
interface BadgeSpec {
  at: LatLng;
  label: string;
  color: string;
  shape: "teardrop" | "circle";
}

function badgesSvg(
  badges: BadgeSpec[],
  center: LatLng,
  zoom: number,
  /** LOGICAL size — the Static Maps `size`, before `scale`. */
  width: number,
  height: number
): string {
  const projection = { center, zoom, imageSizePx: width, imageHeightPx: height };
  // latLngToPixel works in the pre-`scale` pixel space Static Maps' own `size` describes, so
  // its result has to be multiplied up to the actual image. Handing it the scaled size
  // instead lands every pin at exactly half the right distance — which reads as a
  // plausible-but-wrong position rather than as a bug.
  const CIRCLE_R = 15;
  return badges
    .map((b) => {
      const logical = latLngToPixel(projection, b.at);
      const x = logical.x * SCALE;
      const y = logical.y * SCALE;
      // Off-frame badges are skipped rather than clamped to an edge, where a pin would point
      // at something that isn't visible.
      if (x < 0 || y < 0 || x > width * SCALE || y > height * SCALE) return "";
      // Fixed pixel size, deliberately not scaled with the tile count: a badge is chrome, so
      // it wants to be legible on the final image rather than proportional to metres. Same
      // reasoning as the legend and Google's own attribution.
      if (b.shape === "circle") {
        // Translucent, so whatever it lands on still reads through it — a shape's badge sits
        // on the shape it names.
        return `<g transform="translate(${Math.round(x)}, ${Math.round(y)})">
      <circle cx="0" cy="0" r="${CIRCLE_R}" fill="#${b.color}" fill-opacity="0.9" stroke="#ffffff" stroke-width="2.5" />
      ${textToSvgPathsCentred(b.label, { cx: 0, cy: 0, fontSize: 17, fill: "ffffff" })}
    </g>`;
      }
      const scale = 1.6;
      return `<g transform="translate(${Math.round(x)}, ${Math.round(y)}) scale(${scale}) translate(-13, -33)">
      <path d="M13 33C13 33 24.5 19 24.5 13A11.5 11.5 0 1 0 1.5 13C1.5 19 13 33 13 33Z" fill="#${b.color}" stroke="#ffffff" stroke-width="2" />
      ${textToSvgPathsCentred(b.label, { cx: 13, cy: 13, fontSize: 15, fill: "ffffff" })}
    </g>`;
    })
    .filter(Boolean)
    .join("\n    ");
}

const COMPASS_BLUE = "46688a"; // ad-steel — the AusDilaps brand accent

/** One line of the legend's item table. */
export interface LegendRow {
  /** The badge number, or "" for the project site, which has no pin on the map. */
  label: string;
  /** What the item is: a street address, or "Shape 2". */
  name: string;
  /** Colour of the badge number — ties the row to its pin and to its outline. */
  color: string;
  areaSqm: number | null;
}

/**
 * The legend: the three colour meanings, then a hairline, then one row per numbered item.
 *
 * The colour rows keep their pre-baked glyph paths from ./overlay-paths.ts — a GENERATED file
 * holding outlines for exactly those three strings, because Vercel's serverless runtime has no
 * fonts and sharp renders <text> blank. The item rows can't use that (a street name isn't in
 * the file), so they go through text-path.ts's glyph atlas, which handles arbitrary printable
 * ASCII. Both are outlines in the end; the difference is only where they come from.
 *
 * Everything is measured from real glyph widths and the panel grows with the row count. The
 * previous version hardcoded `height = 106` for its three fixed rows, which is exactly the bug
 * that pattern prevents.
 */
function legendSvg(rows: LegendRow[]): string {
  const x = 20;
  const y = 20;
  const keys: [string, string][] = [
    [SITE_RED, "Project Site"],
    [NEIGHBOUR_FILL, "Neighbouring Assets"],
    [SHAPE_COLORS.orange, "Council / External Assets"],
  ];
  const KEY_ROW_HEIGHT = 30;

  const items = rows.map((r) => ({
    ...r,
    ...splitValue(r.areaSqm === null ? "—" : formatArea(r.areaSqm)),
  }));

  // Column widths, all from measured glyph advances.
  const numberColumn = Math.max(0, ...items.map((r) => textWidth(r.label, ROW_SIZE)));
  const nameColumn = Math.max(0, ...items.map((r) => textWidth(r.name, ROW_SIZE)));
  const digitsColumn = Math.max(0, ...items.map((r) => textWidth(r.digits, ROW_SIZE)));
  const unitColumn = Math.max(0, ...items.map((r) => widthWithSuper(r.unit, ROW_SIZE)));

  const keysWidth = Math.max(...keys.map(([, label]) => LEGEND_LABEL_WIDTHS[label] ?? 0));
  const itemsWidth =
    items.length === 0
      ? 0
      : numberColumn + NUM_GAP + nameColumn + NUM_GAP + digitsColumn + UNIT_GAP + unitColumn;
  const width = PANEL_PAD * 2 + Math.max(keysWidth, itemsWidth);

  const keysHeight = keys.length * KEY_ROW_HEIGHT;
  const itemsHeight =
    items.length === 0 ? 0 : TOTAL_GAP + (items.length - 1) * ROW_HEIGHT + ROW_SIZE + TOTAL_GAP;
  const height = PANEL_PAD * 2 + keysHeight + itemsHeight;

  const numberRight = x + PANEL_PAD + numberColumn;
  const nameLeft = numberRight + NUM_GAP;
  const digitsRight = nameLeft + nameColumn + NUM_GAP + digitsColumn;
  const unitLeft = digitsRight + UNIT_GAP;

  const out: string[] = [panelRect(x, y, width, height)];

  // The colour key.
  keys.forEach(([color, label], i) => {
    out.push(
      `<path transform="translate(${x + PANEL_PAD}, ${y + PANEL_PAD + 22 + i * KEY_ROW_HEIGHT})" d="${LEGEND_LABEL_PATHS[label]}" fill="#${color}" />`
    );
  });

  if (items.length === 0) return out.join("\n    ");

  const ruleY = y + PANEL_PAD + keysHeight + TOTAL_GAP / 2;
  out.push(
    `<line x1="${x + PANEL_PAD}" y1="${ruleY.toFixed(1)}" x2="${(x + width - PANEL_PAD).toFixed(1)}" y2="${ruleY.toFixed(1)}" stroke="${HAIRLINE}" stroke-width="1" />`
  );

  let baseline = y + PANEL_PAD + keysHeight + TOTAL_GAP + ROW_SIZE;
  for (const r of items) {
    out.push(
      // Number right-aligned so a two-digit badge still lines up under a one-digit one; the
      // name left-aligned because it is prose; the figures right-aligned so the ones place
      // lines up down the column, with the unit flush beside it.
      textToSvgPaths(r.label, {
        x: numberRight - textWidth(r.label, ROW_SIZE),
        y: baseline,
        fontSize: ROW_SIZE,
        fill: r.color,
      }),
      textToSvgPaths(r.name, { x: nameLeft, y: baseline, fontSize: ROW_SIZE, fill: INK }),
      textToSvgPaths(r.digits, {
        x: digitsRight - textWidth(r.digits, ROW_SIZE),
        y: baseline,
        fontSize: ROW_SIZE,
        fill: INK,
      }),
      textWithSuper(r.unit, unitLeft, baseline, ROW_SIZE, INK)
    );
    baseline += ROW_HEIGHT;
  }

  return out.join("\n    ");
}

/** North arrow, fixed top-right — Static Maps images are always rendered north-up in
 *  this pipeline (no `heading` param used anywhere), so this is a static icon, no
 *  orientation math needed. */
function northArrowSvg(nativeSize: number): string {
  const r = 32;
  const cx = nativeSize - 20 - r;
  const cy = 20 + r;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" fill-opacity="0.95" stroke="#${COMPASS_BLUE}" stroke-width="2.5" />
    <polygon points="${cx},${cy - 18} ${cx - 10},${cy - 2} ${cx + 10},${cy - 2}" fill="#${COMPASS_BLUE}" />
    <path transform="translate(${cx}, ${cy + 18})" d="${COMPASS_N_PATH}" fill="#${COMPASS_BLUE}" />`;
}

export async function renderStandardMarkupImage(input: RenderMapInput): Promise<RenderMapResult> {
  const excluded = new Set(input.excludeIds ?? []);
  const visible = input.neighbours.filter((n) => !excluded.has(n.id));
  const hideSubject = input.hideSubject ?? false;
  const shapes = input.shapes ?? [];
  const flags: string[] = [];

  // Nearest-first, so if the cap bites it drops the lots furthest from the site rather than
  // whichever the cadastre happened to list last.
  const subjectCentroid = centroidOf(input.subjectRing);
  const kept =
    visible.length > MAX_NEIGHBOURS
      ? [...visible]
          .sort((a, b) => {
            const ca = centroidOf(a.ring);
            const cb = centroidOf(b.ring);
            return (
              Math.hypot(ca.lat - subjectCentroid.lat, ca.lng - subjectCentroid.lng) -
              Math.hypot(cb.lat - subjectCentroid.lat, cb.lng - subjectCentroid.lng)
            );
          })
          .slice(0, MAX_NEIGHBOURS)
      : visible;
  if (visible.length > kept.length) {
    flags.push(`${visible.length - kept.length} neighbour lot(s) omitted to fit the map — verify boundaries on site`);
  }

  const { stitched, plan, pxWidth, pxHeight } = await renderTiledStaticMap({
    bounds: input.bounds,
    mapType: input.mapType,
    polygonsFor: (tolerance) => markupPolygons(input.subjectRing, kept, shapes, hideSubject, tolerance),
    styles: ["feature:poi|visibility:off"],
  });

  // Only shapes with a ring get a badge and a legend row — a half-drawn one has no centroid
  // and no area. Its `label` still came from the unfiltered client list, so the numbers that
  // DO appear match the screen.
  const drawnShapes = shapes
    .map((sh) => ({ shape: sh, ring: ringFor(sh), measured: measureShape(sh) }))
    .filter((x) => x.ring.length >= 3);

  // A bubble ONLY where there is a quote item number. Anything drawn but unnumbered — a lot the
  // operator unticked on the sheet, or the project site shown to a client without being billed —
  // keeps its outline and gets nothing on top of it.
  //
  // Teardrops throughout, coloured by the item's own colour, matching map-badge.ts on screen.
  const badges: BadgeSpec[] = [
    ...kept
      .filter((n) => n.label)
      .map((n) => ({
        at: ringAnchor(n.ring) ?? centroidOf(n.ring),
        label: n.label,
        color: NEIGHBOUR_FILL,
        shape: "teardrop" as const,
      })),
    ...drawnShapes
      .filter((x) => x.shape.label)
      .map((x) => ({
        // Guaranteed to be ON the shape — see badgeAnchor. A bent ribbon's centroid is not.
        at: badgeAnchor(x.shape) ?? centroidOf(x.ring),
        label: x.shape.label!,
        color: SHAPE_COLORS[x.shape.color] ?? SHAPE_COLORS.orange,
        shape: "teardrop" as const,
      })),
  ];

  // The legend lists ONLY the quote line items, in item order.
  //
  // Sorted numerically by the number rather than left in "site, lots, shapes" order: with lots
  // and shapes numbered from one series, source order read 1, 3, 4, 1, 2 on a markup with a lot
  // unticked. Sorting is also why an unnumbered row can simply be filtered out rather than
  // leaving a hole.
  const legendRows: LegendRow[] = [
    ...(hideSubject || !input.subjectLabel
      ? []
      : [
          {
            label: input.subjectLabel,
            name: input.subjectStreet || "Project site",
            color: SITE_RED,
            areaSqm: input.subjectAreaSqm ?? null,
          },
        ]),
    ...kept
      .filter((n) => n.label)
      .map((n) => ({
        label: n.label,
        // Street first, because that is what an estimator recognises; falls back to the lot/plan.
        name: n.street || lotPlanFromId(n.id) || "Lot",
        color: NEIGHBOUR_FILL,
        areaSqm: n.areaSqm,
      })),
    ...drawnShapes
      .filter((x) => x.shape.label)
      .map((x) => ({
        label: x.shape.label!,
        // What the operator typed in the sheet's Street cell — "Council Assets" reads far better
        // in a client-facing drawing than "Shape". Falls back when they haven't named it.
        name: x.shape.name?.trim() || "Shape",
        color: SHAPE_COLORS[x.shape.color] ?? SHAPE_COLORS.orange,
        areaSqm: Math.round(x.measured.areaSqm),
      })),
  ].sort((a, b) => Number(a.label) - Number(b.label));

  // Chrome at fixed pixel size, composited over the stitched frame in one sharp call.
  const overlay = Buffer.from(
    `<svg width="${pxWidth}" height="${pxHeight}" xmlns="http://www.w3.org/2000/svg">
    ${badgesSvg(badges, plan.center, plan.zoom, plan.width, plan.height)}
    ${legendSvg(legendRows)}
    ${northArrowSvg(pxWidth)}
  </svg>`
  );

  const composed = await sharp(stitched)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return {
    imageBase64: composed.toString("base64"),
    flags,
    widthPx: pxWidth,
    heightPx: pxHeight,
  };
}
