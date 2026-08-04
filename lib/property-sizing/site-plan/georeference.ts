// Printed scales on these drawings are apparently often wrong (a page resized after export,
// a plotter that didn't honour the stated scale, etc). Rather than trust it blindly, staff can
// cross-check it: pick two identifiable points on the plan (a road corner, a building corner)
// and give their real-world lat/lng — easy to get from Google Maps ("What's here?" → copy
// coordinates). The real-world distance between them vs the pixel distance on the page yields
// an independent scale, expressed the same way as the printed one so it drops straight into
// the existing 1:N calibration pipeline.
const EARTH_RADIUS_M = 6371000;
const MM_PER_POINT = 25.4 / 72;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export function haversineMetres(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pixelDistance(a: PixelPoint, b: PixelPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Given two reference points (their pixel position on a page's native-resolution raster, and
 * their real-world lat/lng), returns the equivalent "1:N" print scale for that page — pass
 * this straight into the normal scaleRatio-based calibration instead of the drawing's own
 * (possibly wrong) stated scale.
 */
export function scaleRatioFromReference(
  pixelA: PixelPoint,
  pixelB: PixelPoint,
  latLngA: LatLng,
  latLngB: LatLng,
  pointWidth: number,
  pixelWidth: number
): number {
  const realMetres = haversineMetres(latLngA, latLngB);
  const pxDist = pixelDistance(pixelA, pixelB);
  const metresPerPixel = realMetres / pxDist;
  const metresPerPoint = metresPerPixel * (pixelWidth / pointWidth);
  return (metresPerPoint * 1000) / MM_PER_POINT;
}

const METRES_PER_DEG_LAT = 111320; // good enough at site-plan/building scale

function metresPerDegLng(atLat: number): number {
  return METRES_PER_DEG_LAT * Math.cos((atLat * Math.PI) / 180);
}

export interface LocalMetres {
  east: number;
  north: number;
}

/** Flat-earth local projection around `origin` — accurate to well under a metre at this scale. */
export function projectToLocalMetres(origin: LatLng, point: LatLng): LocalMetres {
  return {
    east: (point.lng - origin.lng) * metresPerDegLng(origin.lat),
    north: (point.lat - origin.lat) * METRES_PER_DEG_LAT,
  };
}

export function unprojectFromLocalMetres(origin: LatLng, offset: LocalMetres): LatLng {
  return {
    lat: origin.lat + offset.north / METRES_PER_DEG_LAT,
    lng: origin.lng + offset.east / metresPerDegLng(origin.lat),
  };
}

/**
 * A 2D similarity transform (rotation + uniform scale + anchor) solved from two point
 * correspondences — enough to place any other pixel on the page at a real lat/lng, assuming
 * the page is a clean, undistorted scan (no shear/warping), which holds for these PDFs.
 */
export interface GeoTransform {
  anchorPixel: PixelPoint;
  anchorLatLng: LatLng;
  // [east; north] (metres) = [a b; c d] * [pixel.x - anchor.x; anchor.y - pixel.y]
  // (pixel Y is flipped here since image space is Y-down, real space is Y-up/north)
  a: number;
  b: number;
  c: number;
  d: number;
}

export function buildTransform(
  pixelA: PixelPoint,
  pixelB: PixelPoint,
  latLngA: LatLng,
  latLngB: LatLng
): GeoTransform {
  const real = projectToLocalMetres(latLngA, latLngB);
  const pixelEast = pixelB.x - pixelA.x;
  const pixelNorth = -(pixelB.y - pixelA.y);

  const scale = Math.hypot(real.east, real.north) / Math.hypot(pixelEast, pixelNorth);
  const theta = Math.atan2(real.north, real.east) - Math.atan2(pixelNorth, pixelEast);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  return {
    anchorPixel: pixelA,
    anchorLatLng: latLngA,
    a: scale * cosT,
    b: -scale * sinT,
    c: scale * sinT,
    d: scale * cosT,
  };
}

export function pixelToLatLng(transform: GeoTransform, pixel: PixelPoint): LatLng {
  const pixelEast = pixel.x - transform.anchorPixel.x;
  const pixelNorth = -(pixel.y - transform.anchorPixel.y);
  const east = transform.a * pixelEast + transform.b * pixelNorth;
  const north = transform.c * pixelEast + transform.d * pixelNorth;
  return unprojectFromLocalMetres(transform.anchorLatLng, { east, north });
}
