// The tiled Static Maps renderer, shared by both PNG exports.
//
// Google caps `size` at 640 per axis and silently clamps `scale=4` to 2, so 1280x1280 is a
// hard per-request ceiling. Getting BOTH the operator's exact frame and more detail than one
// request allows means fetching several images and stitching them — and getting the frame
// exactly right means framing from BOUNDS, because a live Maps JS map has fractional zoom
// (17.5 is a real state) while Static Maps accepts integers only, so rounding a zoom would
// move the frame by up to 40% of its area.
//
// Extracted UNCHANGED from measure-export.ts when Building Markup moved to a live map and
// needed the same pipeline. One copy, because two would drift: the tile-crop and attribution
// rules below were arrived at empirically and are not obvious enough to re-derive correctly a
// second time.

import sharp from "sharp";
import { pixelToLatLng, type LatLngBox } from "@/lib/kml/standard-markup/projection";
import { buildStaticMapUrl, SCALE, type StaticMapPolygon } from "@/lib/kml/site-markup/static-map";
import { recordApiCall } from "@/lib/api-usage";

// The planning half lives in static-map-plan.ts — pure, so the Cover Photo Generator and its
// check script can import it without `sharp`. Re-exported here so this module stays the one
// name callers have to know.
export {
  MAX_STATIC_DIMENSION,
  ATTRIBUTION_PAD_PX,
  TILE_BAND_CROP_PX,
  planTiles,
  type TileRect,
  type RenderPlan,
} from "./static-map-plan";
import { planTiles, TILE_BAND_CROP_PX } from "./static-map-plan";
import type { RenderPlan, TileRect } from "./static-map-plan";

/** Static Maps caps a request URL around 8192 chars. A dozen 100-point measurements buffer
 *  into rings of ~200 vertices each, which blows that even encoded — so simplify until it
 *  fits rather than let the fetch 414. Tolerances are in metres; 1.5m is invisible at any
 *  zoom this export runs at. */
export const URL_LENGTH_BUDGET = 7600;
export const SIMPLIFY_TOLERANCES_M = [0, 0.3, 1.5, 5];

export interface TiledRenderResult {
  /** The stitched frame with every polygon already drawn by Static Maps, before any chrome. */
  stitched: Buffer;
  plan: RenderPlan;
  pxWidth: number;
  pxHeight: number;
}

/**
 * Fetches and stitches the frame, with the caller's polygons drawn by Static Maps itself.
 *
 * `polygonsFor` is a callback rather than an array because the simplification tolerance is
 * chosen from the longest URL any tile would produce — and ONE tolerance is used across all
 * tiles, since different tiles simplifying differently would break a ring at a seam.
 */
export async function renderTiledStaticMap(input: {
  bounds: LatLngBox;
  mapType: "satellite" | "hybrid" | "roadmap";
  polygonsFor: (toleranceMetres: number) => StaticMapPolygon[];
  styles?: string[];
}): Promise<TiledRenderResult> {
  const plan = planTiles(input.bounds);
  const frame = {
    center: plan.center,
    zoom: plan.zoom,
    imageSizePx: plan.width,
    imageHeightPx: plan.height,
  };

  const tileUrl = (tile: TileRect, tolerance: number) => {
    // Every tile except the bottom-left is fetched taller than it needs and cropped, so its
    // requested centre has to account for the extra band — otherwise the kept top portion
    // shows ground half a band north of where it belongs.
    const requestHeight = tile.height + (tile.keepsAttribution ? 0 : TILE_BAND_CROP_PX);
    const centre = pixelToLatLng(frame, {
      x: tile.x + tile.width / 2,
      y: tile.y + requestHeight / 2,
    });
    return {
      requestHeight,
      url: buildStaticMapUrl({
        mapType: input.mapType,
        // A pinned frame with no adjust — every tile must land exactly where planned.
        frame: { center: centre, fitZoom: plan.zoom },
        zoomAdjust: 0,
        size: { width: tile.width, height: requestHeight },
        // The same polygons go to every tile; Google draws whatever falls inside each
        // viewport, so a ring crossing a seam is continuous once stitched.
        polygons: input.polygonsFor(tolerance),
        styles: input.styles,
      }).url,
    };
  };

  const tolerance =
    SIMPLIFY_TOLERANCES_M.find((t) =>
      plan.tiles.every((tile) => tileUrl(tile, t).url.length <= URL_LENGTH_BUDGET)
    ) ?? SIMPLIFY_TOLERANCES_M[SIMPLIFY_TOLERANCES_M.length - 1];

  const pxWidth = plan.width * SCALE;
  const pxHeight = plan.height * SCALE;

  const layers = await Promise.all(
    plan.tiles.map(async (tile) => {
      const { url, requestHeight } = tileUrl(tile, tolerance);
      const res = await fetch(url);
      // One billed Static Maps request per TILE, not per export.
      void recordApiCall({ provider: "google", api: "static_maps" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Google Static Maps request failed (${res.status}). ${text.slice(0, 200)}`);
      }
      const raw = Buffer.from(await res.arrayBuffer());
      // Crop Google's attribution bar off. Only the bottom-left tile keeps its own, so the
      // stitched image carries exactly one — see planTiles.
      const bytes =
        requestHeight === tile.height
          ? raw
          : await sharp(raw)
              .extract({ left: 0, top: 0, width: tile.width * SCALE, height: tile.height * SCALE })
              .png()
              .toBuffer();
      return { input: bytes, left: tile.x * SCALE, top: tile.y * SCALE };
    })
  );

  const stitched = await sharp({
    create: {
      width: pxWidth,
      height: pxHeight,
      channels: 3,
      // Only ever visible if a tile fetch silently returned something short.
      background: { r: 24, g: 26, b: 28 },
    },
  })
    .composite(layers)
    .png()
    .toBuffer();

  return { stitched, plan, pxWidth, pxHeight };
}
