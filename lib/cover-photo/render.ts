// Renders the cover photo: one aerial frame with the property outlined in green, at exactly
// the report template's dimensions.
//
// Server-side through the Static Maps API rather than a screenshot of the live map, for the
// same reason every other export here is: Maps JS tiles are cross-origin, so the on-screen
// canvas is tainted and can never be read back.
//
// Deliberately thin. There is no legend, no north arrow, no numbered badges and no
// measurement — a report cover is a photograph of the property, and everything the markup
// export draws on top of one is there to serve a quote, not a reader.

import sharp from "sharp";
import type { LatLng } from "@/lib/kml/types";
import { latLngToPixel, type LatLngBox } from "@/lib/kml/standard-markup/projection";
import { SCALE } from "@/lib/kml/site-markup/static-map";
import { ATTRIBUTION_PAD_PX, renderTiledStaticMap } from "@/lib/maps/static-map-tiles";
import { coverFrameBounds } from "./frame";
import {
  COVER_DIM_OUTSIDE_PERCENT,
  COVER_FILL_OPACITY_PERCENT,
  COVER_GREEN,
  COVER_HEIGHT_PX,
  COVER_OUTLINE_WEIGHT,
  COVER_STROKE_OPACITY_PERCENT,
  COVER_WIDTH_PX,
} from "./style";

export type CoverMapType = "satellite" | "hybrid" | "roadmap";

export interface CoverPhotoResult {
  imageBase64: string;
  widthPx: number;
  heightPx: number;
  /** What was actually fetched before the downscale — useful when checking sharpness. */
  renderedWidthPx: number;
  renderedHeightPx: number;
}

/** The green outline, projected onto the stitched frame.
 *
 *  ⚠️ latLngToPixel returns LOGICAL (pre-`scale`) pixels, so the projection is built from the
 *  plan's logical size and each result multiplied by SCALE afterwards. Handing it the scaled
 *  size instead puts every vertex at half the right offset — the outline lands in the
 *  top-left quadrant and looks like a framing bug. */
function projectRing(
  ring: LatLng[],
  center: LatLng,
  zoom: number,
  width: number,
  height: number
): string {
  const projection = { center, zoom, imageSizePx: width, imageHeightPx: height };
  return ring
    .map((pt) => {
      const logical = latLngToPixel(projection, pt);
      return `${(logical.x * SCALE).toFixed(1)},${(logical.y * SCALE).toFixed(1)}`;
    })
    .join(" ");
}

function ringSvg(points: string): string {
  return (
    `<polygon points="${points}" fill="#${COVER_GREEN}" fill-opacity="${COVER_FILL_OPACITY_PERCENT / 100}" ` +
    `stroke="#${COVER_GREEN}" stroke-opacity="${COVER_STROKE_OPACITY_PERCENT / 100}" ` +
    `stroke-width="${COVER_OUTLINE_WEIGHT * SCALE}" stroke-linejoin="round" />`
  );
}

/**
 * A dark scrim over everything OUTSIDE the boundary, so the property reads first.
 *
 * One path, two subpaths, `fill-rule: evenodd` — the outer rectangle minus the boundary ring.
 * Dimming the surroundings rather than the whole image is what makes the shape pop: a uniform
 * scrim knocks the green back by exactly as much as everything else.
 *
 * ⚠️ The scrim FADES OUT over Google's attribution band along the bottom. The Maps Platform
 * terms forbid obscuring that attribution, and a translucent layer over it is still obscuring
 * it — but simply stopping the rectangle short of the band leaves a hard horizontal step
 * across the full width, which is plainly visible on the finished image. A gradient does both
 * jobs: the bar ends up un-dimmed and there is no edge to see.
 *
 * Returns "" when COVER_DIM_OUTSIDE_PERCENT is 0 — the single switch that turns this off.
 */
function dimOutsideSvg(points: string, pxWidth: number, pxHeight: number): string {
  if (COVER_DIM_OUTSIDE_PERCENT <= 0) return "";
  const opacity = COVER_DIM_OUTSIDE_PERCENT / 100;
  const band = ATTRIBUTION_PAD_PX * SCALE;
  // Full strength until a band's height above the bar, clear by halfway into it.
  const holdAt = (pxHeight - 2 * band) / pxHeight;
  const clearAt = (pxHeight - band / 2) / pxHeight;
  const outer = `M0,0 H${pxWidth} V${pxHeight} H0 Z`;
  const inner = `M${points.split(" ").join(" L").replace(/^ L/, "")} Z`;
  return (
    `<defs><linearGradient id="coverDim" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#000000" stop-opacity="${opacity}" />` +
    `<stop offset="${holdAt.toFixed(4)}" stop-color="#000000" stop-opacity="${opacity}" />` +
    `<stop offset="${clearAt.toFixed(4)}" stop-color="#000000" stop-opacity="0" />` +
    `<stop offset="1" stop-color="#000000" stop-opacity="0" />` +
    `</linearGradient></defs>` +
    `<path d="${outer} ${inner}" fill-rule="evenodd" fill="url(#coverDim)" />`
  );
}

/**
 * `bounds` is the live map's viewport — bounds, never centre+zoom, because the map's zoom is
 * fractional (17.5 is a real state) and Static Maps takes integers only, so rounding one
 * would shift the frame by up to 40% of its area.
 *
 * The frame is fetched at whatever detail the tiler can get (typically 2-4x the output) and
 * downscaled to the template's size at the end, so the result is supersampled rather than
 * upscaled — a 600px-wide image asked for directly from Google would be noticeably softer.
 */
export async function renderCoverPhoto(input: {
  ring: LatLng[];
  bounds: LatLngBox;
  mapType: CoverMapType;
}): Promise<CoverPhotoResult> {
  const bounds = coverFrameBounds(input.bounds);

  const { stitched, plan, pxWidth, pxHeight } = await renderTiledStaticMap({
    bounds,
    mapType: input.mapType,
    // Nothing for Static Maps to draw: the outline is composited as SVG below, which is
    // sharper than a `path` parameter and carries no URL-length budget. Road and suburb
    // labels come from the basemap and are the point of the border — only POI pins go.
    polygonsFor: () => [],
    styles: ["feature:poi|visibility:off"],
  });

  const points = projectRing(input.ring, plan.center, plan.zoom, plan.width, plan.height);
  const overlay = Buffer.from(
    `<svg width="${pxWidth}" height="${pxHeight}" xmlns="http://www.w3.org/2000/svg">
    ${dimOutsideSvg(points, pxWidth, pxHeight)}
    ${ringSvg(points)}
  </svg>`
  );

  // TWO sharp passes, deliberately. Sharp's pipeline order is FIXED — resize runs before
  // composite however the calls are chained — so doing both in one pass shrinks the frame to
  // 600x442 first and then tries to paste a 2476px overlay onto it, which fails outright with
  // "Image to composite must have same dimensions or smaller". Compositing at full size and
  // downscaling afterwards is also the better result: the green outline is resampled with the
  // imagery rather than drawn at final size.
  const marked = await sharp(stitched)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();

  const composed = await sharp(marked)
    // "fill", not "cover": coverFrameBounds() has already put the rendered plan on the
    // template's aspect, so this is a scale and not a crop — and a crop would take Google's
    // attribution bar off the bottom, which the Maps Platform terms forbid.
    .resize(COVER_WIDTH_PX, COVER_HEIGHT_PX, { fit: "fill" })
    .png()
    .toBuffer();

  return {
    imageBase64: composed.toString("base64"),
    widthPx: COVER_WIDTH_PX,
    heightPx: COVER_HEIGHT_PX,
    renderedWidthPx: pxWidth,
    renderedHeightPx: pxHeight,
  };
}
