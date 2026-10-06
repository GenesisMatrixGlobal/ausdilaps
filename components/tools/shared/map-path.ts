// Reading an overlay's path back out of Google, for the maps that keep geometry flowing one way
// (Google's overlay → React): the markup map, the measure map and the cover photo map.
//
// Types only from `google.maps` — this module must not touch the `google` global when it is
// imported, because it does not exist until lib/maps/loader.ts has run.

import type { LatLng } from "@/lib/kml/types";

/** Exact equality, not a tolerance: these are the same doubles Google handed us, round
 *  tripped through lat()/lng(). A tolerance would only mask a bug. */
export function samePath(a: LatLng[], b: LatLng[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => p.lat === b[i].lat && p.lng === b[i].lng);
}

export function readPath(overlay: google.maps.Polygon | google.maps.Polyline): LatLng[] {
  return overlay
    .getPath()
    .getArray()
    .map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
}
