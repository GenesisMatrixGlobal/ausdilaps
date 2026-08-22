// Shared "turn resolved geometry into a PNG" step for Standard Mark Up — used by both
// the initial full-resolve route and the lightweight re-render route (which re-draws
// after the user excludes a neighbour lot, without repeating the geocode/cadastre/
// Overpass work). Kept separate from resolve.ts so the render-only route never needs
// to import the geocoding/ArcGIS machinery.

import sharp from "sharp";
import type { LatLng } from "@/lib/kml/types";
import { buildStaticMapUrl, GoogleMapsConfigError, IMAGE_SIZE, SCALE } from "@/lib/kml/site-markup/static-map";
import { COMPASS_N_PATH, LEGEND_LABEL_PATHS } from "./overlay-paths";
import { bufferLineToPolygon, simplifyRing } from "./geometry";
import type { StandardMarkupNeighbour } from "./resolve";

export { GoogleMapsConfigError };

const NEIGHBOUR_FILL = "1d4ed8"; // blue
const NEIGHBOUR_FILL_OPACITY = 50;
const NEIGHBOUR_STROKE_OPACITY = 90;
const MARKER_COLOR = "e8642a"; // safety orange — matches the Site Markup preset
const COUNCIL_ASSET_FILL_OPACITY = 50;
const COUNCIL_ASSET_STROKE_OPACITY = 90;
const SITE_RED = "ff0000";
const SITE_FILL_OPACITY = 50;
const SITE_STROKE_WEIGHT = 5;

export interface CouncilAssetInput {
  points: LatLng[];
  widthMetres: number;
}

// Google Static Maps caps request URLs around 8192 chars. DCDB geometry can carry
// redundant near-collinear vertices — simplify before encoding, and if still too long,
// simplify harder + cap neighbour count rather than let the Static Maps fetch 414.
const URL_LENGTH_BUDGET = 7800;
const SIMPLIFY_TOLERANCE_M = 0.4;
const SIMPLIFY_TOLERANCE_M_AGGRESSIVE = 1.5;
const MAX_NEIGHBOURS = 12;

/** Google Static Maps marker labels must be a single character — numbers 1-9, then
 *  letters, for the rare block with more than 9 neighbours. */
export function markerLabel(index: number): string {
  return index < 9 ? String(index + 1) : String.fromCharCode(65 + (index - 9));
}

export interface NumberedNeighbour extends StandardMarkupNeighbour {
  label: string;
}

/** Assigns each neighbour a stable display number, in the order given — call this once,
 *  right after resolving, and keep the labels attached for every later re-render so a
 *  lot's number never changes as others get excluded. */
export function numberNeighbours(neighbours: StandardMarkupNeighbour[]): NumberedNeighbour[] {
  return neighbours.map((n, i) => ({ ...n, label: markerLabel(i) }));
}

function centroidOf(ring: LatLng[]): LatLng {
  const lat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
  const lng = ring.reduce((s, p) => s + p.lng, 0) / ring.length;
  return { lat, lng };
}

export interface RenderMapInput {
  subjectRing: LatLng[];
  /** All neighbours to consider — already numbered; `excludeIds` is applied here, not by the caller. */
  neighbours: NumberedNeighbour[];
  mapType: "satellite" | "hybrid" | "roadmap";
  zoomAdjust: number;
  excludeIds?: string[];
  /** Drops the numbered neighbour pins — used for the client-facing download, which
   *  doesn't need staff's internal checklist reference numbers. */
  hideMarkers?: boolean;
  /** User-drawn council-asset lines (click-to-place points + a width each) — a list, not
   *  one, since a property can need two disconnected assets (e.g. a front road frontage
   *  and an unrelated rear laneway). */
  councilAssets?: CouncilAssetInput[];
}

export interface RenderMapResult {
  imageBase64: string;
  flags: string[];
  /** Projection parameters for the image just rendered — the client needs these to
   *  convert a click on the displayed image into a real lat/lng for council-asset
   *  point placement. */
  center: LatLng;
  zoom: number;
  imageSizePx: number;
  scale: number;
}

function buildMap(
  subjectRing: LatLng[],
  neighbours: NumberedNeighbour[],
  mapType: "satellite" | "hybrid" | "roadmap",
  zoomAdjust: number,
  tolerance: number,
  neighbourCap: number,
  hideMarkers: boolean,
  councilAssets: CouncilAssetInput[]
): { url: string; center: LatLng; zoom: number; omittedNeighbours: number } {
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

  const councilPolygons = councilAssets
    .filter((a) => a.points.length >= 2)
    .map((a) => bufferLineToPolygon(a.points, a.widthMetres));

  const { url, center, zoom } = buildStaticMapUrl({
    ways: [],
    color: NEIGHBOUR_FILL,
    opacityPercent: NEIGHBOUR_FILL_OPACITY,
    mapType,
    zoomAdjust,
    polygons: [
      // The subject property — red-lined per the standard building-inspection site
      // marking convention. Its ring also anchors the frame's bounds, both so the map
      // is centred sensibly on the actual address and so there's still something to
      // fit/render when a property genuinely has zero true neighbours.
      {
        ring: simplifyRing(subjectRing, tolerance),
        fillColor: SITE_RED,
        fillOpacityPercent: SITE_FILL_OPACITY,
        strokeColor: SITE_RED,
        strokeOpacityPercent: 100,
        strokeWeight: SITE_STROKE_WEIGHT,
      },
      ...kept.map((n) => ({
        ring: simplifyRing(n.ring, tolerance),
        fillColor: NEIGHBOUR_FILL,
        fillOpacityPercent: NEIGHBOUR_FILL_OPACITY,
        strokeColor: NEIGHBOUR_FILL,
        strokeOpacityPercent: NEIGHBOUR_STROKE_OPACITY,
      })),
      ...councilPolygons.map((ring) => ({
        ring,
        fillColor: MARKER_COLOR,
        fillOpacityPercent: COUNCIL_ASSET_FILL_OPACITY,
        strokeColor: MARKER_COLOR,
        strokeOpacityPercent: COUNCIL_ASSET_STROKE_OPACITY,
      })),
    ],
    markers: hideMarkers ? [] : kept.map((n) => ({ point: centroidOf(n.ring), label: n.label, color: MARKER_COLOR })),
    // Hides business/POI pins (cafes, shops, parks) — noise for a site markup. Roads,
    // street names, and address-number labels are a different feature class, unaffected.
    styles: ["feature:poi|visibility:off"],
  });

  return { url, center, zoom, omittedNeighbours: neighbours.length - kept.length };
}

const COMPASS_BLUE = "46688a"; // ad-steel — the AusDilaps brand accent

/** Legend, fixed top-left — each row is coloured bold text (no separate swatch chip),
 *  the same convention as "PROJECT SITE" reading directly in red on the map itself. One
 *  semi-opaque white panel behind all three lines keeps it legible over any imagery. */
function legendSvg(): string {
  const x = 20;
  const y = 20;
  const width = 236;
  const height = 106;
  const rows: [string, string][] = [
    [SITE_RED, "Project Site"],
    [NEIGHBOUR_FILL, "Neighbouring Assets"],
    [MARKER_COLOR, "Council Assets"],
  ];
  const lines = rows
    .map(
      ([color, label], i) =>
        `<path transform="translate(${x + 16}, ${y + 34 + i * 30})" d="${LEGEND_LABEL_PATHS[label]}" fill="#${color}" />`
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

  const hideMarkers = input.hideMarkers ?? false;
  const councilAssets = input.councilAssets ?? [];
  const flags: string[] = [];
  let built = buildMap(
    input.subjectRing,
    visible,
    input.mapType,
    input.zoomAdjust,
    SIMPLIFY_TOLERANCE_M,
    MAX_NEIGHBOURS,
    hideMarkers,
    councilAssets
  );
  if (built.url.length > URL_LENGTH_BUDGET) {
    built = buildMap(
      input.subjectRing,
      visible,
      input.mapType,
      input.zoomAdjust,
      SIMPLIFY_TOLERANCE_M_AGGRESSIVE,
      Math.min(MAX_NEIGHBOURS, 8),
      hideMarkers,
      councilAssets
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
  };
}
