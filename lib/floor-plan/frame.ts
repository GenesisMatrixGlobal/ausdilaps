/**
 * The frame of a satellite backdrop: enough Web Mercator to turn a view the operator chose on
 * a live map into a Static Maps request that reproduces it, and to move pins when it changes.
 *
 * Why this exists: Static Maps takes a centre, an INTEGER zoom and a size; a live Maps JS map
 * has a fractional zoom and whatever shape its container is. Matching the two by rounding the
 * zoom moves the frame by up to 40% of its area — which is the "it snapped to a zoom I didn't
 * set" problem. Matching them by holding the zoom and solving for the SIZE instead is exact:
 * ground covered is size x 2^-zoom, and size is free to be any integer up to Google's cap.
 *
 * Pure and dependency-free, because the picker (client), the editor (client) and the image
 * route (server) all have to agree about where a pin is, exactly.
 */

export type LatLng = { lat: number; lng: number };
export type Bounds = { south: number; west: number; north: number; east: number };

/** A Static Maps request, in its own terms. `width`/`height` are "points" — `scale` doubles
 *  the pixels delivered without changing the ground covered or the cap. */
export type Frame = { centre: LatLng; zoom: number; width: number; height: number };

const TILE = 256;
/** Google's hard cap per side, on any account and at any scale. */
export const MAX_SIDE = 640;
/** Past 21 Australian imagery is upsampled — there is nothing further to see. */
export const MAX_ZOOM = 21;

/** World coordinates, 0..1 across the whole map. y grows southward. */
export function worldX(lng: number): number {
  return (lng + 180) / 360;
}
export function worldY(lat: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
export function lngAt(x: number): number {
  return x * 360 - 180;
}
export function latAt(y: number): number {
  const n = Math.PI - 2 * Math.PI * y;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * The biggest Static Maps request that covers `bounds`.
 *
 * Takes the deepest zoom at which the frame still fits inside 640x640 points, then asks for
 * exactly the size that frame needs. Deepest-that-fits rather than a fixed zoom because the
 * size cap is also the RESOLUTION cap: one level shallower would deliver the same picture
 * with half the detail.
 */
export function frameForBounds(bounds: Bounds): Frame {
  const fx = Math.abs(worldX(bounds.east) - worldX(bounds.west));
  const fy = Math.abs(worldY(bounds.south) - worldY(bounds.north));
  const fit = (fraction: number) => Math.log2(MAX_SIDE / Math.max(fraction * TILE, 1e-12));
  const zoom = Math.max(0, Math.min(MAX_ZOOM, Math.floor(Math.min(fit(fx), fit(fy)))));
  const scale = TILE * 2 ** zoom;
  const side = (fraction: number) => Math.max(1, Math.min(MAX_SIDE, Math.round(fraction * scale)));
  return {
    centre: {
      lat: latAt((worldY(bounds.north) + worldY(bounds.south)) / 2),
      lng: lngAt((worldX(bounds.west) + worldX(bounds.east)) / 2),
    },
    zoom,
    width: side(fx),
    height: side(fy),
  };
}

/** A frame centred on a point at a given zoom, shaped to `aspect` (width / height). Used to
 *  open the picker somewhere sensible before the operator has framed anything. */
export function frameAt(centre: LatLng, zoom: number, aspect: number): Frame {
  const height = MAX_SIDE;
  return {
    centre,
    zoom: Math.max(0, Math.min(MAX_ZOOM, Math.round(zoom))),
    width: Math.max(1, Math.min(MAX_SIDE, Math.round(height * aspect))),
    height,
  };
}

/** What a frame actually covers, which is what the picker reopens on. */
export function boundsOfFrame(f: Frame): Bounds {
  const scale = TILE * 2 ** f.zoom;
  const cx = worldX(f.centre.lng) * scale;
  const cy = worldY(f.centre.lat) * scale;
  return {
    west: lngAt((cx - f.width / 2) / scale),
    east: lngAt((cx + f.width / 2) / scale),
    north: latAt((cy - f.height / 2) / scale),
    south: latAt((cy + f.height / 2) / scale),
  };
}

/** The place a point sits, as a fraction of each side of the frame. (0,0) is top-left. */
export function pointAt(f: Frame, u: number, v: number): LatLng {
  const scale = TILE * 2 ** f.zoom;
  const x = worldX(f.centre.lng) * scale + (u - 0.5) * f.width;
  const y = worldY(f.centre.lat) * scale + (v - 0.5) * f.height;
  return { lat: latAt(y / scale), lng: lngAt(x / scale) };
}

export function fractionAt(f: Frame, p: LatLng): { u: number; v: number } {
  const scale = TILE * 2 ** f.zoom;
  const cx = worldX(f.centre.lng) * scale;
  const cy = worldY(f.centre.lat) * scale;
  return {
    u: (worldX(p.lng) * scale - cx) / f.width + 0.5,
    v: (worldY(p.lat) * scale - cy) / f.height + 0.5,
  };
}
