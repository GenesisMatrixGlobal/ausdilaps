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
import { renderTiledStaticMap } from "@/lib/maps/static-map-tiles";
import { coverFrameBounds } from "./frame";
import {
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
function ringSvg(ring: LatLng[], center: LatLng, zoom: number, width: number, height: number): string {
  if (ring.length < 3) return "";
  const projection = { center, zoom, imageSizePx: width, imageHeightPx: height };
  const points = ring
    .map((pt) => {
      const logical = latLngToPixel(projection, pt);
      return `${(logical.x * SCALE).toFixed(1)},${(logical.y * SCALE).toFixed(1)}`;
    })
    .join(" ");
  return (
    `<polygon points="${points}" fill="#${COVER_GREEN}" fill-opacity="${COVER_FILL_OPACITY_PERCENT / 100}" ` +
    `stroke="#${COVER_GREEN}" stroke-opacity="${COVER_STROKE_OPACITY_PERCENT / 100}" ` +
    `stroke-width="${COVER_OUTLINE_WEIGHT * SCALE}" stroke-linejoin="round" />`
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

  const overlay = Buffer.from(
    `<svg width="${pxWidth}" height="${pxHeight}" xmlns="http://www.w3.org/2000/svg">
    ${ringSvg(input.ring, plan.center, plan.zoom, plan.width, plan.height)}
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
