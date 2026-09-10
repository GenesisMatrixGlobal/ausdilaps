// ArcGIS ring ↔ the tool's LatLng ring. ArcGIS is `[x, y]` = `[lng, lat]`, outer ring first,
// usually closed; the markup and the geometry helpers want `{lat, lng}` and cope with either.

import type { LatLng } from "@/lib/kml/types";

export function latLngRingFromArcgis(rings: number[][][] | undefined): LatLng[] | null {
  const outer = rings?.[0];
  if (!outer || outer.length < 3) return null;
  const pts = outer.map(([x, y]) => ({ lat: y, lng: x }));
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length > 3 && first.lat === last.lat && first.lng === last.lng) pts.pop();
  return pts.length >= 3 ? pts : null;
}

export function arcgisRingsFromLatLng(ring: LatLng[]): number[][][] {
  const pts = ring.map((p) => [p.lng, p.lat]);
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first && (first[0] !== last[0] || first[1] !== last[1])) pts.push([first[0], first[1]]);
  return [pts];
}
