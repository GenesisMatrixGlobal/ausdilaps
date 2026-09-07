// Converts between a pixel position on a rendered Static Maps image and a lat/lng.
// Same Web Mercator formula family as static-map.ts's zoom-fit math. Client-safe (pure
// math, no Node/DOM APIs) — imported directly into the standard-markup-tab.tsx client
// component for custom-shape point placement: `pixelToLatLng` turns a click into a
// real coordinate, `latLngToPixel` turns a placed point back into an on-screen position
// for the overlay dots (needed so dots stay correctly placed if zoom changes before the
// user hits Regenerate — they're re-projected live from the stored lat/lng, not frozen
// pixel coordinates).

import type { LatLng } from "@/lib/kml/types";

const WORLD_PX = 256; // tile size at zoom 0

function latToWorldY(lat: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  const clamped = Math.max(Math.min(sin, 0.9999), -0.9999);
  return WORLD_PX * (0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI));
}

function lngToWorldX(lng: number): number {
  return WORLD_PX * (0.5 + lng / 360);
}

function worldYToLat(worldY: number): number {
  const n = Math.PI - (2 * Math.PI * worldY) / WORLD_PX;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function worldXToLng(worldX: number): number {
  return (worldX / WORLD_PX - 0.5) * 360;
}

export interface PixelProjection {
  center: LatLng;
  zoom: number;
  /** Native output size in pixels (Static Maps `size` — before the `scale` multiplier).
   *  The WIDTH when `imageHeightPx` is given. */
  imageSizePx: number;
  /** Height, for a non-square image. Defaults to `imageSizePx` — every caller but the
   *  Measure tab's PNG export renders square. */
  imageHeightPx?: number;
}

/** Maps a pixel position (in the same native, pre-`scale` pixel space Static Maps' own
 *  `size` parameter describes) back to a lat/lng. */
export function pixelToLatLng(proj: PixelProjection, pixel: { x: number; y: number }): LatLng {
  const scale = 2 ** proj.zoom;
  const centerWorldX = lngToWorldX(proj.center.lng);
  const centerWorldY = latToWorldY(proj.center.lat);
  const worldX = centerWorldX + (pixel.x - proj.imageSizePx / 2) / scale;
  const worldY = centerWorldY + (pixel.y - (proj.imageHeightPx ?? proj.imageSizePx) / 2) / scale;
  return { lat: worldYToLat(worldY), lng: worldXToLng(worldX) };
}

/** The reverse of `pixelToLatLng` — maps a lat/lng to its pixel position, in the same
 *  native pre-`scale` pixel space. */
export function latLngToPixel(proj: PixelProjection, point: LatLng): { x: number; y: number } {
  const scale = 2 ** proj.zoom;
  const worldX = lngToWorldX(point.lng);
  const worldY = latToWorldY(point.lat);
  const centerWorldX = lngToWorldX(proj.center.lng);
  const centerWorldY = latToWorldY(proj.center.lat);
  return {
    x: (worldX - centerWorldX) * scale + proj.imageSizePx / 2,
    y: (worldY - centerWorldY) * scale + (proj.imageHeightPx ?? proj.imageSizePx) / 2,
  };
}

export interface LatLngBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * A box's Mercator span in world pixels (i.e. at zoom 0), plus its true centre.
 *
 * Multiply a span by `2 ** zoom` for the size in native pre-`scale` pixels that the box
 * occupies at that zoom — which is how the Measure tab's PNG export picks a Static Maps
 * `size` that frames exactly what was on screen, whatever fractional zoom the live map
 * happened to be at.
 *
 * The centre is computed in world-pixel space, not by averaging latitudes: Mercator is
 * non-linear in latitude, so the mean of north and south is NOT the centre of the frame,
 * and using it shifts the export vertically against the live map.
 */
export function mercatorSpan(box: LatLngBox): { spanX: number; spanY: number; center: LatLng } {
  const westX = lngToWorldX(box.west);
  const eastX = lngToWorldX(box.east);
  // A box straddling the antimeridian wraps; irrelevant in Australia, but cheap to be
  // right about rather than returning a negative span.
  const spanX = eastX >= westX ? eastX - westX : eastX + WORLD_PX - westX;
  const northY = latToWorldY(box.north);
  const southY = latToWorldY(box.south);
  return {
    spanX,
    spanY: southY - northY,
    center: {
      lat: worldYToLat((northY + southY) / 2),
      lng: worldXToLng((westX + spanX / 2) % WORLD_PX),
    },
  };
}
