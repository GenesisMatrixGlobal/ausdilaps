// Shared "turn resolved geometry into a PNG" step for Standard Mark Up — used by both
// the initial full-resolve route and the lightweight re-render route (which re-draws
// after the user excludes a neighbour lot, without repeating the geocode/cadastre/
// Overpass work). Kept separate from resolve.ts so the render-only route never needs
// to import the geocoding/ArcGIS machinery.

import sharp from "sharp";
import type { LatLng } from "@/lib/kml/types";
import { buildStaticMapUrl, GoogleMapsConfigError, IMAGE_SIZE, SCALE } from "@/lib/kml/site-markup/static-map";
import { COMPASS_N_PATH, LEGEND_LABEL_PATHS, LEGEND_LABEL_WIDTHS } from "./overlay-paths";
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
import { markerLabel } from "./labels";
import type { StandardMarkupNeighbour } from "./resolve";

export { GoogleMapsConfigError };
export { markerLabel } from "./labels";

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
}

// Google Static Maps caps request URLs around 8192 chars. DCDB geometry can carry
// redundant near-collinear vertices — simplify before encoding, and if still too long,
// simplify harder + cap neighbour count rather than let the Static Maps fetch 414.
const URL_LENGTH_BUDGET = 7800;
const SIMPLIFY_TOLERANCE_M = 0.4;
const SIMPLIFY_TOLERANCE_M_AGGRESSIVE = 1.5;
const MAX_NEIGHBOURS = 12;

export interface NumberedNeighbour extends StandardMarkupNeighbour {
  label: string;
}

/** Assigns each neighbour a stable display number, in the order given — call this once,
 *  right after resolving, and keep the labels attached for every later re-render so a
 *  lot's number never changes as others get excluded.
 *
 *  The label is drawn by the CLIENT, as an SVG bubble in the markup overlay, not baked
 *  into the PNG here. That's deliberate: the overlay sits above the map image, so a bubble
 *  drawn there stays on top of any custom shape, and unticking a lot removes it with no
 *  round trip. Don't reintroduce Static Maps `markers` for these — you'd get two sets. */
export function numberNeighbours(neighbours: StandardMarkupNeighbour[]): NumberedNeighbour[] {
  return neighbours.map((n, i) => ({ ...n, label: markerLabel(i) }));
}

export interface RenderMapInput {
  subjectRing: LatLng[];
  /** All neighbours to consider — already numbered; `excludeIds` is applied here, not by the caller. */
  neighbours: NumberedNeighbour[];
  mapType: "satellite" | "hybrid" | "roadmap";
  zoomAdjust: number;
  excludeIds?: string[];
  /** Drops the cadastre-derived red project-site boundary. The ring is still used to
   *  anchor the frame, so hiding it never moves the photo. */
  hideSubject?: boolean;
  /** Drops the blue neighbouring-lot fills, keeping them as frame anchors. The first
   *  Generate uses this: the client's overlay draws every vector, so baking them here as
   *  well painted each lot twice — two 50% fills compound to 75%. They must still shape
   *  the bounds, or the frame fits the subject lot alone and crops the very lots the
   *  overlay is about to paint. */
  hideNeighbours?: boolean;
  /** Pins the frame to one captured from an earlier render, so nothing the operator does
   *  to the geometry re-frames the photo. Omit on the first render to fit to the geometry. */
  frame?: { center: LatLng; fitZoom: number };
  /** User-drawn shapes (click-to-place points, each a line or an area) — a list, not one,
   *  since a property can need several unrelated ones (e.g. a front road frontage and an
   *  adjacent building). */
  shapes?: MarkupShapeInput[];
}

export interface RenderMapResult {
  imageBase64: string;
  flags: string[];
  /** Projection parameters for the image just rendered — the client needs these to
   *  convert a click on the displayed image into a real lat/lng for custom-shape
   *  point placement. */
  center: LatLng;
  zoom: number;
  imageSizePx: number;
  scale: number;
  /** The frame's zoom before `zoomAdjust` — the client captures this once and sends it
   *  back to pin the frame on every later render. */
  fitZoom: number;
}

function buildMap(
  subjectRing: LatLng[],
  neighbours: NumberedNeighbour[],
  mapType: "satellite" | "hybrid" | "roadmap",
  zoomAdjust: number,
  tolerance: number,
  neighbourCap: number,
  hideSubject: boolean,
  hideNeighbours: boolean,
  shapes: MarkupShapeInput[],
  frame: { center: LatLng; fitZoom: number } | undefined
): { url: string; center: LatLng; zoom: number; fitZoom: number; omittedNeighbours: number } {
  const subjectCentroid = centroidOf(subjectRing);
  const kept =
    neighbours.length > neighbourCap
      ? [...neighbours]
          .sort((a, b) => {
            const da = Math.hypot(centroidOf(a.ring).lat - subjectCentroid.lat, centroidOf(a.ring).lng - subjectCentroid.lng);
            const db = Math.hypot(centroidOf(b.ring).lat - subjectCentroid.lat, centroidOf(b.ring).lng - subjectCentroid.lng);
            return da - db;
          })
          .slice(0, neighbourCap)
      : neighbours;

  // An area needs 3 points to enclose anything; a line needs 2 to have a direction to
  // buffer perpendicular to. Anything short of that yields an empty ring and is dropped,
  // so a half-drawn shape simply doesn't render rather than erroring the whole map.
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

  const { url, center, zoom, fitZoom } = buildStaticMapUrl({
    frame,
    mapType,
    zoomAdjust,
    // Everything the frame should fit, drawn or not. The subject ring centres the map on
    // the actual address and gives it something to fit when a property has no true
    // neighbours, so it has to keep doing that even when the operator has unticked it to
    // redraw the boundary by hand. The neighbour rings are here for the same reason: the
    // first Generate draws no polygons at all (the client's overlay draws them), and
    // without them the frame fits the subject lot alone and crops the neighbours the
    // overlay is about to paint. Anchoring rather than relying on `polygons` is what
    // makes the frame identical whether a ring is drawn or hidden.
    boundsAnchor: [...subjectRing, ...kept.flatMap((n) => n.ring)],
    polygons: [
      // The subject property — red-lined per the standard building-inspection site
      // marking convention.
      ...(hideSubject
        ? []
        : [
            {
              ring: simplifyRing(subjectRing, tolerance),
              fillColor: SITE_RED,
              fillOpacityPercent: FILL_OPACITY_PERCENT,
              strokeColor: SITE_RED,
              strokeOpacityPercent: SITE_STROKE_OPACITY_PERCENT,
              strokeWeight: OUTLINE_WEIGHT,
            },
          ]),
      ...(hideNeighbours ? [] : kept).map((n) => ({
        ring: simplifyRing(n.ring, tolerance),
        fillColor: NEIGHBOUR_FILL,
        fillOpacityPercent: FILL_OPACITY_PERCENT,
        strokeColor: NEIGHBOUR_FILL,
        strokeOpacityPercent: STROKE_OPACITY_PERCENT,
        strokeWeight: OUTLINE_WEIGHT,
      })),
      ...shapePolygons.map(({ ring, color }) => ({
        ring,
        fillColor: color,
        fillOpacityPercent: FILL_OPACITY_PERCENT,
        strokeColor: color,
        strokeOpacityPercent: STROKE_OPACITY_PERCENT,
        strokeWeight: OUTLINE_WEIGHT,
      })),
    ],
    // Hides business/POI pins (cafes, shops, parks) — noise for a site markup. Roads,
    // street names, and address-number labels are a different feature class, unaffected.
    styles: ["feature:poi|visibility:off"],
  });

  return { url, center, zoom, fitZoom, omittedNeighbours: neighbours.length - kept.length };
}

const COMPASS_BLUE = "46688a"; // ad-steel — the AusDilaps brand accent

/** Legend, fixed top-left — each row is coloured bold text (no separate swatch chip),
 *  the same convention as "PROJECT SITE" reading directly in red on the map itself. One
 *  semi-opaque white panel behind all three lines keeps it legible over any imagery. */
function legendSvg(): string {
  const x = 20;
  const y = 20;
  const height = 106;
  const rows: [string, string][] = [
    [SITE_RED, "Project Site"],
    [NEIGHBOUR_FILL, "Neighbouring Assets"],
    [SHAPE_COLORS.orange, "Council / External Assets"],
  ];
  // Sized from the generated glyph widths rather than a hardcoded number, so changing the
  // legend copy can never silently clip it — 236px was already only 5px clear of
  // "Council / External Assets".
  const PAD = 16;
  const width = PAD * 2 + Math.max(...rows.map(([, label]) => LEGEND_LABEL_WIDTHS[label] ?? 0));
  const lines = rows
    .map(
      ([color, label], i) =>
        `<path transform="translate(${x + PAD}, ${y + 34 + i * 30})" d="${LEGEND_LABEL_PATHS[label]}" fill="#${color}" />`
    )
    .join("\n    ");
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="white" fill-opacity="0.9" stroke="#cccccc" stroke-width="1.5" />
    ${lines}`;
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

/** Combines the legend and north arrow into one SVG sized to the native output image —
 *  Static Maps has no legend/icon parameters of its own, so this gets composited onto
 *  the fetched PNG afterward in a single sharp call. */
function buildOverlaySvg(): Buffer {
  const nativeSize = IMAGE_SIZE * SCALE;
  const svg = `<svg width="${nativeSize}" height="${nativeSize}" xmlns="http://www.w3.org/2000/svg">
    ${legendSvg()}
    ${northArrowSvg(nativeSize)}
  </svg>`;
  return Buffer.from(svg);
}

export async function renderStandardMarkupImage(input: RenderMapInput): Promise<RenderMapResult> {
  const excluded = new Set(input.excludeIds ?? []);
  const visible = input.neighbours.filter((n) => !excluded.has(n.id));

  const hideSubject = input.hideSubject ?? false;
  const hideNeighbours = input.hideNeighbours ?? false;
  const shapes = input.shapes ?? [];
  const flags: string[] = [];
  let built = buildMap(
    input.subjectRing,
    visible,
    input.mapType,
    input.zoomAdjust,
    SIMPLIFY_TOLERANCE_M,
    MAX_NEIGHBOURS,
    hideSubject,
    hideNeighbours,
    shapes,
    input.frame
  );
  if (built.url.length > URL_LENGTH_BUDGET) {
    built = buildMap(
      input.subjectRing,
      visible,
      input.mapType,
      input.zoomAdjust,
      SIMPLIFY_TOLERANCE_M_AGGRESSIVE,
      Math.min(MAX_NEIGHBOURS, 8),
      hideSubject,
      hideNeighbours,
      shapes,
      input.frame
    );
  }
  if (built.omittedNeighbours > 0) {
    flags.push(`${built.omittedNeighbours} neighbour lot(s) omitted to fit the map — verify boundaries on site`);
  }

  const imgRes = await fetch(built.url);
  if (!imgRes.ok) {
    const text = await imgRes.text().catch(() => "");
    throw new Error(`Google Static Maps request failed (${imgRes.status}). ${text.slice(0, 200)}`);
  }
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const labelled = await sharp(buffer)
    .composite([{ input: buildOverlaySvg(), top: 0, left: 0 }])
    .png()
    .toBuffer();
  return {
    imageBase64: labelled.toString("base64"),
    flags,
    center: built.center,
    zoom: built.zoom,
    imageSizePx: IMAGE_SIZE,
    scale: SCALE,
    fitZoom: built.fitZoom,
  };
}
