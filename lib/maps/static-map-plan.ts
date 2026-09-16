// The pure half of the tiled Static Maps renderer: working out WHICH requests cover a given
// box, at what zoom, and where each lands in the stitched frame.
//
// Extracted VERBATIM from static-map-tiles.ts (which keeps the fetching and stitching) so
// that callers who only need the geometry — the Cover Photo Generator's framing maths, and
// its pure check script — can import it without dragging in `sharp`. One copy, because two
// would drift: the tile-crop and attribution rules below were arrived at empirically and are
// not obvious enough to re-derive correctly a second time.

import type { LatLngBox } from "@/lib/kml/standard-markup/projection";
import { mercatorSpan } from "@/lib/kml/standard-markup/projection";
import type { LatLng } from "@/lib/kml/types";
/** Google's hard cap on either `size` dimension. */
export const MAX_STATIC_DIMENSION = 640;
/** Past this, AU aerial imagery is upsampled — the same ceiling the live map uses. */
const MAX_ZOOM = 21;
/**
 * Extra ground framed along the bottom, in logical (pre-`scale`) pixels, for Google's
 * attribution bar to sit on.
 *
 * Google draws "Google / Map data ©… Airbus, Maxar…" OVER the imagery, about 30 output px
 * tall at scale 2, so without this it occludes the bottom of the live view — and a
 * measurement drawn near the bottom edge disappears under it. Framing a strip of extra
 * ground is the only fix available: the bar's size is fixed by Google (it scales WITH
 * `scale`, so no scale/size combination shrinks it relative to the map), and cropping or
 * shrinking it is exactly what the Maps Platform terms forbid.
 */
export const ATTRIBUTION_PAD_PX = 20;

/**
 * How much of a tile's bottom edge Google's attribution bar occupies, in logical px.
 *
 * Measured at ~15; 22 is that plus headroom, since the bar's height is not contractual.
 * Every tile EXCEPT the bottom-left one is requested this much taller and then cropped, so
 * the bar doesn't end up burned across the middle of the stitched image.
 */
export const TILE_BAND_CROP_PX = 22;

/** Requests per export. Each is a billed Static Maps call, and at 8 a wide frame still gets
 *  the full 2x detail while a pathological one falls back to a single request. */
const MAX_TILES = 8;

export interface TileRect {
  /** Position within the whole frame, in logical px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** True for the one tile whose Google attribution bar is KEPT. */
  keepsAttribution: boolean;
}

export interface RenderPlan {
  zoom: number;
  /** Whole-frame logical size, including the attribution pad in the height. */
  width: number;
  height: number;
  /** Centre of the whole frame. */
  center: LatLng;
  tiles: TileRect[];
}

/** Even splits, so every tile's size and centre land on whole logical pixels. An odd size
 *  puts Static Maps' centre on a half pixel, which at scale 2 is a 1px seam. */
function evenBoundaries(total: number, count: number): number[] {
  const out = [0];
  for (let i = 1; i < count; i++) out.push(2 * Math.round((total * i) / count / 2));
  out.push(total);
  return out;
}

/**
 * Boundaries for the BOTTOM row, biased so the leftmost tile is as wide as Google allows.
 *
 * That tile is the one whose attribution bar is kept, and Google renders the provider list
 * to fit the width it was asked for — at 506px it clipped to "data ©2026 Google Imagery…",
 * losing the leading "Map". A full-width tile gives it room for the whole credit. The
 * remainder splits evenly across the rest, and always fits: cols = ceil(width / 640)
 * guarantees width <= 640 * cols.
 */
function attributionBiasedBoundaries(total: number, count: number): number[] {
  if (count === 1 || total <= MAX_STATIC_DIMENSION) return evenBoundaries(total, count);
  const first = MAX_STATIC_DIMENSION;
  const rest = evenBoundaries(total - first, count - 1);
  return [0, ...rest.map((x) => x + first)];
}

/**
 * Plans the requests that cover exactly the given bounds, at the finest detail available.
 *
 * Google caps `size` at 640 per axis, so a frame wider than that at the zoom you want has to
 * be fetched as several images and stitched. That is the ONLY way to get both the operator's
 * exact frame and more detail than one request allows — widening the frame to fill the budget
 * was tried and reverted, because it fills the extra pixels with more ground rather than more
 * detail (see the note below).
 *
 * One zoom deeper than the single-request fit, so 2x the linear detail, whenever that costs
 * MAX_TILES requests or fewer. Otherwise a single request, which is the same code path with a
 * 1x1 grid.
 */
export function planTiles(bounds: LatLngBox): RenderPlan {
  const { spanX, spanY, center } = mercatorSpan(bounds);

  // The largest integer zoom at which the whole frame fits one request.
  let base = MAX_ZOOM;
  while (
    base > 1 &&
    (spanX * 2 ** base > MAX_STATIC_DIMENSION ||
      spanY * 2 ** base + ATTRIBUTION_PAD_PX > MAX_STATIC_DIMENSION)
  ) {
    base -= 1;
  }

  // ⚠️ Do NOT widen the frame to spend the rest of the 640px budget at `base`. Integer zoom
  // levels leave the frame between 320 and 640px, so up to 38% goes unused — but scaling the
  // frame up at the same zoom fills that with MORE GROUND, because metres-per-pixel is fixed
  // by the zoom. The export then stops showing what the operator framed, which is a worse
  // fault than a small image. Tried and reverted on 2026-09-07. Tiling is the answer instead.
  const plan = (zoom: number): RenderPlan | null => {
    const at = 2 ** zoom;
    // Even, so the boundary splits below stay on whole pixels.
    const width = 2 * Math.ceil((spanX * at) / 2);
    const height = 2 * Math.ceil((spanY * at + ATTRIBUTION_PAD_PX) / 2);
    // Every tile but the bottom-left is fetched TILE_BAND_CROP_PX taller and cropped, so its
    // usable height is capped below 640 by that much.
    const cols = Math.ceil(width / MAX_STATIC_DIMENSION);
    const rows = Math.ceil(height / (MAX_STATIC_DIMENSION - TILE_BAND_CROP_PX));
    if (cols * rows > MAX_TILES) return null;

    const xs = evenBoundaries(width, cols);
    const bottomXs = attributionBiasedBoundaries(width, cols);
    const ys = evenBoundaries(height, rows);
    const tiles: TileRect[] = [];
    for (let r = 0; r < rows; r++) {
      const bottom = r === rows - 1;
      const rowXs = bottom ? bottomXs : xs;
      for (let c = 0; c < cols; c++) {
        tiles.push({
          x: rowXs[c],
          y: ys[r],
          width: rowXs[c + 1] - rowXs[c],
          height: ys[r + 1] - ys[r],
          // The bottom-left tile keeps Google's bar exactly where Google drew it, over the
          // frame's own bottom-left — which the ATTRIBUTION_PAD_PX strip makes sure is
          // spare ground rather than a measurement. Every other tile's bar is cropped, so
          // the composite carries ONE unmodified Google attribution instead of one per tile.
          // Nothing is redrawn: the provider list ("Airbus, CNES / Airbus, Landsat /
          // Copernicus…") arrives as pixels, not data, so it cannot be reproduced by hand.
          keepsAttribution: bottom && c === 0,
        });
      }
    }
    return { zoom, width, height, center, tiles };
  };

  return (base < MAX_ZOOM ? plan(base + 1) : null) ?? plan(base)!;
}
