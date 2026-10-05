import type { LatLng } from "@/lib/kml/types";

/** The outer ring of an ArcGIS polygon (`[lng, lat]` pairs) as the LatLng ring the markup
 *  uses. Shared by the three state cadastre adapters — it was byte-identical in each. */
export function outerRingToLatLng(rings?: number[][][]): LatLng[] {
  const ring = rings?.[0];
  if (!ring) return [];
  return ring.map(([lng, lat]) => ({ lat, lng }));
}
