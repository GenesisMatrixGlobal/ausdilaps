// Framing maths for the cover photo. Pure — no env, no network, no `sharp` — so the live map
// and the check script both import it, and the frame the operator sees is the frame the
// server renders.
//
// Two jobs, and they are different:
//   coverViewFor()     the frame Generate drops the operator into — the parcel plus enough
//                      ground around it to read the street names.
//   coverFrameBounds() the frame the export renders — whatever the operator ended up
//                      looking at, squared off to the report template's aspect.

import type { LatLng } from "@/lib/kml/types";
import { mercatorSpan, pixelToLatLng, type LatLngBox } from "@/lib/kml/standard-markup/projection";
import { ATTRIBUTION_PAD_PX, planTiles } from "@/lib/maps/static-map-plan";
import { COVER_ASPECT } from "./style";

const WORLD_PX = 256; // tile size at zoom 0 — the unit mercatorSpan works in
const EARTH_CIRCUMFERENCE_M = 40075016.686;

/** Ground added around the parcel, as a fraction of its own span on each side. */
const MARGIN_FACTOR = 0.25;

/**
 * Narrowest the frame is ever allowed to get, east-west.
 *
 * The margin alone is not enough on a suburban block: a 700 m² lot is about 15 m wide, and
 * 15 m plus 45% a side is a 33 m frame — the house fills it and there is no street, no
 * neighbour and no label in shot, which is the opposite of what a report cover is for. This
 * floor puts the property, both neighbours and the road in frame.
 */
export const MIN_FRAME_METRES = 90;

function worldPxPerMetre(lat: number): number {
  return WORLD_PX / (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180));
}

/** A box from its centre and its Mercator spans — the inverse of mercatorSpan(). Built on
 *  pixelToLatLng at zoom 0, where scale is 1 and a pixel offset IS a world-pixel offset, so
 *  there is no second copy of the projection to drift. */
function boxFrom(center: LatLng, spanX: number, spanY: number): LatLngBox {
  const proj = { center, zoom: 0, imageSizePx: spanX, imageHeightPx: spanY };
  const nw = pixelToLatLng(proj, { x: 0, y: 0 });
  const se = pixelToLatLng(proj, { x: spanX, y: spanY });
  return { north: nw.lat, west: nw.lng, south: se.lat, east: se.lng };
}

function bboxOf(points: LatLng[]): LatLngBox {
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const p of points) {
    if (p.lat > north) north = p.lat;
    if (p.lat < south) south = p.lat;
    if (p.lng > east) east = p.lng;
    if (p.lng < west) west = p.lng;
  }
  return { north, south, east, west };
}

/** Grows the shorter axis until the box matches the target aspect. Only ever GROWS, so
 *  nothing already in frame is pushed out. */
function toAspect(center: LatLng, spanX: number, spanY: number): { spanX: number; spanY: number } {
  return spanX / spanY < COVER_ASPECT
    ? { spanX: spanY * COVER_ASPECT, spanY }
    : { spanX, spanY: spanX / COVER_ASPECT };
}

/** How much ground one click of the toolbar's Zoom control adds or removes. 1.3 is a
 *  noticeable step without being a whole Google zoom level (which doubles the ground and
 *  overshoots every time). */
const ZOOM_STEP = 1.3;

/**
 * The frame Generate lands on: the parcel, its margin, the metre floor, at the report's
 * aspect.
 *
 * `step` is the toolbar's Zoom control — positive is tighter, negative is wider. It scales
 * the finished frame rather than the margin, so it works the same on a suburban block held
 * at the metre floor as on a rural parcel where the margin dominates.
 */
export function coverViewFor(ring: LatLng[], step = 0): LatLngBox | null {
  if (ring.length < 3) return null;
  const { spanX, spanY, center } = mercatorSpan(bboxOf(ring));
  const grow = 1 + 2 * MARGIN_FACTOR;
  const floorX = MIN_FRAME_METRES * worldPxPerMetre(center.lat);
  const zoom = ZOOM_STEP ** -step;
  const fitted = toAspect(
    center,
    Math.max(spanX * grow, floorX) * zoom,
    Math.max(spanY * grow, floorX / COVER_ASPECT) * zoom
  );
  return boxFrom(center, fitted.spanX, fitted.spanY);
}

/**
 * The box the export renders, from whatever the operator framed.
 *
 * Does two things, and the second is the one that is easy to miss. planTiles() frames
 * ATTRIBUTION_PAD_PX of EXTRA ground along the bottom for Google's attribution bar to sit on
 * (cropping or shrinking that bar is exactly what the Maps Platform terms forbid). So a box
 * whose GROUND is at the target aspect renders at `w x (w/A + pad)` — slightly too tall —
 * and the final resize would be a hidden vertical squash. Shortening the ground by the pad
 * makes the rendered plan itself land on the target aspect, so the resize is 1:1.
 *
 * The pad is a pixel count, so its size in ground depends on the zoom, which depends on the
 * box: hence the short loop. It settles on the first or second pass in practice, and the
 * fallback is simply a frame a couple of pixels off — which the resize absorbs.
 */
export function coverFrameBounds(view: LatLngBox): LatLngBox {
  const { spanX, spanY, center } = mercatorSpan(view);
  const first = toAspect(center, spanX, spanY);
  let box = boxFrom(center, first.spanX, first.spanY);

  for (let pass = 0; pass < 3; pass++) {
    const { zoom } = planTiles(box);
    const pad = ATTRIBUTION_PAD_PX / 2 ** zoom;
    // Never crops: the width is at least what was framed, and at least what the framed
    // height needs once the pad is accounted for.
    const width = Math.max(spanX, (spanY + pad) * COVER_ASPECT);
    const next = boxFrom(center, width, width / COVER_ASPECT - pad);
    if (planTiles(next).zoom === zoom) return next;
    box = next;
  }
  return box;
}
