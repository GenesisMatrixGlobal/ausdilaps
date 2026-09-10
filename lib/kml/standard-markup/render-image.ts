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
import { textToSvgPathsCentred } from "@/lib/kml/overlay/text-path";
// Only the panel chrome now. The row primitives (ROW_SIZE, splitValue, textWithSuper, …) are
// still shared with the Measure export, which does list each measurement — they are unused HERE
// because this legend is the colour key alone.
import { PANEL_PAD, panelRect } from "@/lib/kml/overlay/legend";
import { badgeAnchor, measureShape, ringAnchor, ringFor } from "./measure";
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
  /** What the operator named it on the sheet. ⚠️ NOT DRAWN — the legend that printed it was
   *  reduced to the colour key. Kept on the wire because re-enabling an item schedule should be
   *  a change to legendSvg alone, not a change to the schema, the route and the client too. */
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
  /** Red for the address a multi-property markup was searched from. Absent = blue. */
  color?: "red" | "blue";
  /** From the state address layer. ⚠️ NOT DRAWN — it named this lot in the retired legend
   *  schedule; see `name` on MarkupShapeInput. Optional: a lot the layer
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
  /** ⚠️ NOT DRAWN, same as `name` above — these fed the legend's project-site row. Retained
   *  rather than removed so the item schedule can come back without a schema change. */
  subjectStreet?: string | null;
  subjectAreaSqm?: number | null;
  /** The site's quote item number, or "" when it is drawn but not a line item — which is the
   *  usual case, since the site is normally shown to the client rather than billed. ⚠️ Also NOT
   *  DRAWN now: the site has never had a pin, so its number only ever appeared in the legend. */
  subjectLabel?: string;
  /**
   * Draw the outlines in the SVG composite instead of as Static Maps `path` params.
   *
   * The URL route carries every ring in every tile request under a ~7,600-character budget, so
   * the tiler simplifies rings to fit and this renderer caps the lot count at MAX_NEIGHBOURS.
   * A multi-property markup (the *DEV* tab) has 20-50 lots, which would arrive as blobs with
   * most of them missing. Drawn here there is no budget: the same latLngToPixel projection the
   * badges use puts every vertex where it belongs. Off by default — the shipped Building Markup
   * export stays exactly as it was.
   */
  overlayOutlines?: boolean;
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
    ...kept.map((n) => {
      const red = n.color === "red";
      return {
        ring: simplify(n.ring),
        fillColor: red ? SITE_RED : NEIGHBOUR_FILL,
        fillOpacityPercent: FILL_OPACITY_PERCENT,
        strokeColor: red ? SITE_RED : NEIGHBOUR_FILL,
        strokeOpacityPercent: red ? SITE_STROKE_OPACITY_PERCENT : STROKE_OPACITY_PERCENT,
        strokeWeight: OUTLINE_WEIGHT,
      };
    }),
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
/**
 * Every polygon as SVG, for `overlayOutlines`. Same fill/stroke figures the Static Maps route
 * uses, so a drawing looks the same whichever way its outlines were drawn — only the tile
 * background comes from Google now.
 */
function outlinesSvg(
  polygons: StaticMapPolygon[],
  center: LatLng,
  zoom: number,
  /** LOGICAL size — the Static Maps `size`, before `scale`. */
  width: number,
  height: number
): string {
  const projection = { center, zoom, imageSizePx: width, imageHeightPx: height };
  return polygons
    .map((p) => {
      const points = p.ring
        .map((pt) => {
          const logical = latLngToPixel(projection, pt);
          return `${(logical.x * SCALE).toFixed(1)},${(logical.y * SCALE).toFixed(1)}`;
        })
        .join(" ");
      // Google's `weight` is in logical pixels; the composite is drawn at SCALE.
      return (
        `<polygon points="${points}" fill="#${p.fillColor}" fill-opacity="${(p.fillOpacityPercent ?? FILL_OPACITY_PERCENT) / 100}" ` +
        `stroke="#${p.strokeColor}" stroke-opacity="${(p.strokeOpacityPercent ?? STROKE_OPACITY_PERCENT) / 100}" ` +
        `stroke-width="${(p.strokeWeight ?? OUTLINE_WEIGHT) * SCALE}" stroke-linejoin="round" />`
      );
    })
    .join("\n    ");
}

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

/**
 * How much bigger than its natural size the legend and north arrow are drawn.
 *
 * These are read on a ~1400px-wide export, often printed inside a report, and at 1x the key was
 * a postage stamp in the corner. NOT tied to the image width on purpose: the export's dimensions
 * follow the operator's viewport aspect through the tiling planner, so a proportional rule would
 * make the key a different size on every drawing of the same job.
 */
const OVERLAY_SCALE = 2;
/** Inset from the image edge, in FINAL pixels — so it is unaffected by OVERLAY_SCALE. */
const MARGIN = 20;

/**
 * The colour key rows, in fixed order, for the colours that are actually ON this drawing.
 *
 * A key that explains a colour the reader cannot see is worse than no key: on a markup that is
 * only council infrastructure it invited the question "where is the project site?". Order is
 * fixed rather than sorted so the same colour is always in the same place across a set of
 * drawings for one job.
 *
 * The labels are the only three strings overlay-paths.ts has pre-baked glyphs for, so this may
 * filter them but must never invent one.
 */
function colourKeys(shown: { red: boolean; blue: boolean; orange: boolean }): [string, string][] {
  const keys: [string, string][] = [];
  if (shown.red) keys.push([SITE_RED, "Project Site"]);
  if (shown.blue) keys.push([NEIGHBOUR_FILL, "Neighbouring Assets"]);
  if (shown.orange) keys.push([SHAPE_COLORS.orange, "Council / External Assets"]);
  return keys;
}

/**
 * The legend: the colour meanings, and nothing else.
 *
 * It briefly also listed every numbered quote item with its street and area. That was dropped
 * on request — useful in concept, too busy on a drawing a client sees, and it duplicated a table
 * the estimator already has on screen and in Salesforce. The numbered pins stay: they are the
 * quote item numbers, and cross-referencing them is what they are for.
 *
 * The labels use pre-baked glyph paths from ./overlay-paths.ts — a GENERATED file holding
 * outlines for exactly those three strings, because Vercel's serverless runtime has no fonts and
 * sharp renders <text> blank. With the item rows gone, nothing here needs text-path.ts's
 * arbitrary-ASCII atlas any more.
 *
 * Sized from real glyph widths and grown from the row count. The version before last hardcoded
 * `height = 106` for its three fixed rows, which is exactly the bug that pattern prevents — and
 * the row count is no longer fixed, since a colour absent from the drawing is absent here too.
 *
 * Drawn at its natural size around the origin and then scaled as a whole GROUP, rather than by
 * multiplying every coordinate through: the labels are pre-baked outlines whose glyph size is
 * inside the path data, so there is no font size here to turn up. Scaling the group takes the
 * panel, its corner radius, its border and the text together, which is the only way they stay in
 * proportion to each other.
 */
function legendSvg(keys: [string, string][]): string {
  if (keys.length === 0) return "";

  const KEY_ROW_HEIGHT = 30;
  const width = PANEL_PAD * 2 + Math.max(0, ...keys.map(([, label]) => LEGEND_LABEL_WIDTHS[label] ?? 0));
  const height = PANEL_PAD * 2 + keys.length * KEY_ROW_HEIGHT;

  const inner = [
    panelRect(0, 0, width, height),
    ...keys.map(
      ([color, label], i) =>
        `<path transform="translate(${PANEL_PAD}, ${PANEL_PAD + 22 + i * KEY_ROW_HEIGHT})" d="${LEGEND_LABEL_PATHS[label]}" fill="#${color}" />`
    ),
  ].join("\n      ");

  return `<g transform="translate(${MARGIN}, ${MARGIN}) scale(${OVERLAY_SCALE})">
      ${inner}
    </g>`;
}

function northArrowSvg(nativeSize: number): string {
  const r = 32;
  // Scaled with the legend so the two corners look like they belong to the same drawing. Placed
  // by its scaled footprint, or it would run off the right edge.
  const cx = (nativeSize - MARGIN) / OVERLAY_SCALE - r;
  const cy = MARGIN / OVERLAY_SCALE + r;
  return `<g transform="scale(${OVERLAY_SCALE})">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="white" fill-opacity="0.95" stroke="#${COMPASS_BLUE}" stroke-width="2.5" />
      <polygon points="${cx},${cy - 18} ${cx - 10},${cy - 2} ${cx + 10},${cy - 2}" fill="#${COMPASS_BLUE}" />
      <path transform="translate(${cx}, ${cy + 18})" d="${COMPASS_N_PATH}" fill="#${COMPASS_BLUE}" />
    </g>`;
}

export async function renderStandardMarkupImage(input: RenderMapInput): Promise<RenderMapResult> {
  const excluded = new Set(input.excludeIds ?? []);
  const visible = input.neighbours.filter((n) => !excluded.has(n.id));
  const hideSubject = input.hideSubject ?? false;
  const shapes = input.shapes ?? [];
  const flags: string[] = [];

  const overlayOutlines = input.overlayOutlines ?? false;

  // Nearest-first, so if the cap bites it drops the lots furthest from the site rather than
  // whichever the cadastre happened to list last. The cap exists only for the URL route —
  // outlines drawn in the composite have no budget to fit, so every lot is kept.
  //
  // A multi-property markup has no subject ring; sort from the middle of the lots instead, so
  // centroidOf() is never asked about an empty ring.
  const subjectCentroid =
    input.subjectRing.length >= 3
      ? centroidOf(input.subjectRing)
      : centroidOf(visible.flatMap((n) => n.ring));
  const kept =
    !overlayOutlines && visible.length > MAX_NEIGHBOURS
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
    // With overlayOutlines the tiles carry no geometry at all — the polygons are drawn below.
    polygonsFor: (tolerance) =>
      overlayOutlines ? [] : markupPolygons(input.subjectRing, kept, shapes, hideSubject, tolerance),
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
        color: n.color === "red" ? SITE_RED : NEIGHBOUR_FILL,
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

  // What colours are actually on the drawing. A colour counts whether it arrived as cadastre
  // geometry or as a hand-drawn shape: red is the subject boundary or a redrawn site, blue is a
  // detected lot or a shape inside the property, orange is only ever a drawn shape.
  const keys = colourKeys({
    red: !hideSubject || kept.some((n) => n.color === "red") || drawnShapes.some((x) => x.shape.color === "red"),
    blue: kept.some((n) => n.color !== "red") || drawnShapes.some((x) => x.shape.color === "blue"),
    orange: drawnShapes.some((x) => x.shape.color === "orange"),
  });

  // Chrome at fixed pixel size, composited over the stitched frame in one sharp call.
  const overlay = Buffer.from(
    `<svg width="${pxWidth}" height="${pxHeight}" xmlns="http://www.w3.org/2000/svg">
    ${
      overlayOutlines
        ? outlinesSvg(
            // Tolerance 0: nothing to fit a URL into, so every vertex is drawn.
            markupPolygons(input.subjectRing, kept, shapes, hideSubject, 0),
            plan.center,
            plan.zoom,
            plan.width,
            plan.height
          )
        : ""
    }
    ${badgesSvg(badges, plan.center, plan.zoom, plan.width, plan.height)}
    ${legendSvg(keys)}
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
