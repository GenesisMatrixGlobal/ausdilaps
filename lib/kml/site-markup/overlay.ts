// The Road Markup label panel, composited onto the Static Maps PNG by sharp.
//
// Same visual convention as the Residential Mark Up overlay (semi-opaque white panel,
// top-left, bold coloured text) so the two tools produce a consistent set of images for a
// report. Text is drawn in the same colour as the traced road so the label and the line on
// the map read as one thing.
//
// Text is outlined glyph geometry rather than SVG <text> — Vercel's serverless runtime has
// no fonts, so <text> renders blank there. See lib/kml/overlay/text-path.ts.

import { textToSvgPaths, textWidth } from "@/lib/kml/overlay/text-path";
import { northArrowSvg } from "@/lib/kml/overlay/north-arrow";
import type { RoadLeg } from "@/lib/kml/road-segments/google-directions";

const FONT_SIZE = 22;
const LINE_HEIGHT = 30;
const PADDING_X = 16;
const PADDING_Y = 14;
const MARGIN = 20;
const MIN_WIDTH = 150;

/** The road breakdown is secondary detail, so it sits smaller and tighter than the title. */
const ROAD_FONT_SIZE = 16;
const ROAD_LINE_HEIGHT = 22;
/** Gap between the total and the first road row. */
const ROAD_LIST_GAP = 8;
/**
 * Beyond this the panel starts covering the map it's annotating, so the image shows the
 * first few and the browser carries the full list (which is more useful as copyable text
 * for a report anyway).
 */
const MAX_ROADS_ON_IMAGE = 6;
/** A single road just repeats the title. Two or more is real information — and in
 *  cross-street mode it means the trace left the road it was asked for. */
const MIN_ROADS_TO_SHOW = 2;

export interface RoadOverlayOptions {
  /** Width/height of the composited image in pixels (it's square). */
  nativeSize: number;
  /** Road name, or a route label. Omitted when the operator didn't give one. */
  title?: string;
  /** Traced centerline length, in km. */
  lengthKm: number;
  /** Hex colour without the leading '#'; matches the road line. */
  color: string;
  /** Ordered roads travelled. Rendered only when there are at least two. */
  roads?: RoadLeg[];
}

/** Formats the traced length the way a field note would read it. */
export function formatLengthKm(lengthKm: number): string {
  return lengthKm < 1 ? `${Math.round(lengthKm * 1000)} m` : `${lengthKm.toFixed(2)} km`;
}

/** `1. Brinkworth Rd - 5.77 km`, or a trailing `+3 more` when the list is truncated.
 *
 *  ASCII hyphen, not an em dash: the glyph atlas covers printable ASCII only, so anything
 *  outside it renders as the fallback "?" character. */
function roadListLines(roads: RoadLeg[]): string[] {
  if (roads.length < MIN_ROADS_TO_SHOW) return [];

  const shown = roads.slice(0, MAX_ROADS_ON_IMAGE);
  const lines = shown.map(
    (road, i) =>
      `${i + 1}. ${road.name ?? "Unnamed road"} - ${formatLengthKm(road.distanceMeters / 1000)}`
  );

  const hidden = roads.length - shown.length;
  if (hidden > 0) lines.push(`+${hidden} more`);
  return lines;
}

export function buildRoadOverlaySvg(opts: RoadOverlayOptions): Buffer {
  const headingLines = [opts.title?.trim(), formatLengthKm(opts.lengthKm)].filter(
    (l): l is string => Boolean(l)
  );
  const roadLines = roadListLines(opts.roads ?? []);

  // Panel grows to fit its widest line — road names run from "Mason St" to "Grand Parade
  // South Service Road" — but never past the image edge.
  const widest = Math.max(
    ...headingLines.map((l) => textWidth(l, FONT_SIZE)),
    ...roadLines.map((l) => textWidth(l, ROAD_FONT_SIZE))
  );
  const width = Math.min(
    Math.max(MIN_WIDTH, Math.ceil(widest) + PADDING_X * 2),
    opts.nativeSize - MARGIN * 2
  );

  const headingBlock = LINE_HEIGHT * headingLines.length - (LINE_HEIGHT - FONT_SIZE);
  const roadBlock =
    roadLines.length > 0 ? ROAD_LIST_GAP + ROAD_LINE_HEIGHT * roadLines.length : 0;
  const height = PADDING_Y * 2 + headingBlock + roadBlock;

  const firstBaseline = MARGIN + PADDING_Y + FONT_SIZE;
  const headingText = headingLines
    .map((line, i) =>
      textToSvgPaths(line, {
        x: MARGIN + PADDING_X,
        y: firstBaseline + i * LINE_HEIGHT,
        fontSize: FONT_SIZE,
        fill: opts.color,
      })
    )
    .join("\n    ");

  const roadsBaseline = firstBaseline + headingBlock - FONT_SIZE + ROAD_LIST_GAP + ROAD_FONT_SIZE;
  const roadText = roadLines
    .map((line, i) =>
      textToSvgPaths(line, {
        x: MARGIN + PADDING_X,
        y: roadsBaseline + i * ROAD_LINE_HEIGHT,
        fontSize: ROAD_FONT_SIZE,
        fill: opts.color,
      })
    )
    .join("\n    ");

  const text = [headingText, roadText].filter(Boolean).join("\n    ");

  const svg = `<svg width="${opts.nativeSize}" height="${opts.nativeSize}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${MARGIN}" y="${MARGIN}" width="${width}" height="${height}" rx="10" fill="white" fill-opacity="0.9" stroke="#cccccc" stroke-width="1.5" />
    ${text}
    ${northArrowSvg(opts.nativeSize)}
  </svg>`;

  return Buffer.from(svg);
}
