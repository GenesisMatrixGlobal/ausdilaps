// Builds a Google Static Maps URL that highlights a road's real course with a
// semi-transparent overlay, framed tight around the road (not the whole suburb).
//
// Deliberately computes `center` + `zoom` ourselves (standard Web Mercator
// fit-to-bounds math, the same formula behind the well-known Google Maps JS
// "getBoundsZoomLevel" snippet) rather than leaning on Static Maps' own
// auto-fit (omitting center/zoom entirely). Auto-fit was tried first — it
// snaps to the nearest whole zoom level that contains the requested points,
// which in testing meant the frame stayed identical however much extra
// padding was added, since a modest padding change didn't cross an actual
// zoom threshold. Computing zoom explicitly (floored to the tightest integer
// that still fits the buffered bounds) gives real, direct control over how
// tightly the road fills the frame.

import type { LatLng } from "@/lib/kml/types";
import { encodePolyline } from "@/lib/kml/road-segments/polyline";

const STATIC_MAP_URL = "https://maps.googleapis.com/maps/api/staticmap";
// Static Maps caps `size` at 640x640 on a standard billing account; `scale` doubles the
// actual pixel output without counting against that cap or changing the geographic area
// shown, so 500x500 @ scale 2 -> a 1000x1000px image of the same 500x500 "point" extent.
const IMAGE_SIZE = 500;
const SCALE = 2;
const DEFAULT_WEIGHT = 14;
const MAX_ZOOM = 20; // satellite imagery in most AU suburbs stays sharp to ~20-21

export class GoogleMapsConfigError extends Error {}

export interface StaticMapPolygon {
  /** Closed automatically if not already. */
  ring: LatLng[];
  /** 6-digit hex, no '#'. */
  fillColor: string;
  fillOpacityPercent: number;
  strokeColor: string;
  strokeOpacityPercent: number;
  strokeWeight?: number;
}

export interface BuildStaticMapUrlOptions {
  ways: LatLng[][];
  /** 6-digit hex, no '#'. */
  color: string;
  opacityPercent: number;
  mapType: "satellite" | "hybrid" | "roadmap";
  weight?: number;
  /** Shifts the auto-computed tight-fit zoom — negative zooms out for more context, positive zooms in tighter. */
  zoomAdjust?: number;
  /** Filled + outlined polygons (e.g. neighbouring lots) rendered alongside `ways`. */
  polygons?: StaticMapPolygon[];
}

function pathColor(hexColor: string, opacityPercent: number): string {
  const alpha = Math.round((opacityPercent / 100) * 255);
  return `0x${hexColor}${alpha.toString(16).padStart(2, "0")}`;
}

interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

function boundsOf(points: LatLng[]): Bounds {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

// Breathing room added around the road's own bounding box before computing zoom, as a
// fraction of its span — plus a floor so a short, near-straight road still gets context.
const PADDING_FACTOR = 0.15;
const MIN_PAD_DEG = 0.0006; // ~65m

function bufferedBounds(points: LatLng[]): Bounds {
  const b = boundsOf(points);
  const latPad = Math.max((b.maxLat - b.minLat) * PADDING_FACTOR, MIN_PAD_DEG);
  const lngPad = Math.max((b.maxLng - b.minLng) * PADDING_FACTOR, MIN_PAD_DEG);
  return {
    minLat: b.minLat - latPad,
    maxLat: b.maxLat + latPad,
    minLng: b.minLng - lngPad,
    maxLng: b.maxLng + lngPad,
  };
}

const WORLD_PX = 256; // tile size at zoom 0

function latRad(lat: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  const radX2 = Math.log((1 + sin) / (1 - sin)) / 2;
  return Math.max(Math.min(radX2, Math.PI), -Math.PI) / 2;
}

function zoomForFraction(mapPx: number, fraction: number): number {
  return Math.floor(Math.log2(mapPx / WORLD_PX / Math.max(fraction, 1e-9)));
}

/** Largest integer zoom at which `bounds` still fits inside a `mapPx` x `mapPx` frame. */
function zoomToFit(bounds: Bounds, mapPx: number): number {
  const latFraction = (latRad(bounds.maxLat) - latRad(bounds.minLat)) / Math.PI;
  let lngDiff = bounds.maxLng - bounds.minLng;
  if (lngDiff < 0) lngDiff += 360;
  const lngFraction = lngDiff / 360;
  return Math.max(1, Math.min(zoomForFraction(mapPx, latFraction), zoomForFraction(mapPx, lngFraction), MAX_ZOOM));
}

export function buildStaticMapUrl(opts: BuildStaticMapUrlOptions): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new GoogleMapsConfigError(
      "GOOGLE_MAPS_API_KEY not configured — Site Markup needs the Maps Static API enabled on the same key used for Google Maps links."
    );
  }

  const visibleWays = opts.ways.filter((w) => w.length >= 2);
  const polygons = (opts.polygons ?? []).filter((p) => p.ring.length >= 3);
  if (visibleWays.length === 0 && polygons.length === 0) {
    throw new Error("No road geometry to render.");
  }

  const bounds = bufferedBounds([...visibleWays.flat(), ...polygons.flatMap((p) => p.ring)]);
  const center = { lat: (bounds.minLat + bounds.maxLat) / 2, lng: (bounds.minLng + bounds.maxLng) / 2 };
  const zoom = Math.max(1, Math.min(zoomToFit(bounds, IMAGE_SIZE) + (opts.zoomAdjust ?? 0), MAX_ZOOM));

  const url = new URL(STATIC_MAP_URL);
  url.searchParams.set("size", `${IMAGE_SIZE}x${IMAGE_SIZE}`);
  url.searchParams.set("scale", String(SCALE));
  url.searchParams.set("maptype", opts.mapType);
  url.searchParams.set("format", "png");
  url.searchParams.set("center", `${center.lat},${center.lng}`);
  url.searchParams.set("zoom", String(zoom));

  const color = pathColor(opts.color, opts.opacityPercent);
  const weight = opts.weight ?? DEFAULT_WEIGHT;
  for (const way of visibleWays) {
    url.searchParams.append("path", `color:${color}|weight:${weight}|enc:${encodePolyline(way)}`);
  }

  for (const polygon of polygons) {
    const fill = pathColor(polygon.fillColor, polygon.fillOpacityPercent);
    const stroke = pathColor(polygon.strokeColor, polygon.strokeOpacityPercent);
    const strokeWeight = polygon.strokeWeight ?? 2;
    const first = polygon.ring[0];
    const last = polygon.ring[polygon.ring.length - 1];
    const closedRing = first.lat === last.lat && first.lng === last.lng ? polygon.ring : [...polygon.ring, first];
    url.searchParams.append(
      "path",
      `color:${stroke}|weight:${strokeWeight}|fillcolor:${fill}|enc:${encodePolyline(closedRing)}`
    );
  }

  url.searchParams.set("key", key);
  return url.toString();
}
