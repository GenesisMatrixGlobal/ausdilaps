// A deep link into Google Street View, at a point on the ground.
//
// The parse half of this job lives next door in parse-google-maps-url.ts, which reads a URL an
// operator pasted in. This writes one.

import type { LatLng } from "@/lib/kml/types";

/**
 * Street View, opened at the panorama nearest to `at`.
 *
 * Six decimals is ~0.11 m, well inside the accuracy of a cadastre outline.
 *
 * ⚠️ NO `heading`, and NOT because the default is good — because the alternatives cost money.
 * Google's Maps URLs reference claims that with heading absent, "a default heading is chosen
 * based on the viewpoint (if specified) of the query and the actual location of the image". That
 * is not what happens on the desktop web client. Tested 2026-09-08 at Newport: two viewpoints
 * 30 m apart on OPPOSITE bearings from the same camera produced a byte-identical canonical URL,
 * `3a,90y,90t` with no `h` term and `yaw=0` — due north both times. An explicit `heading=107` was
 * honoured exactly (`107h`), so the parameter works; Google simply does not derive one.
 *
 * Deriving it ourselves needs the CAMERA's position, which is a metadata lookup, and both routes
 * to one were rejected:
 *   - Street View Static API `/streetview/metadata` is documented free ("No quota is consumed"),
 *     but the API is not activated on our Cloud project — it answers REQUEST_DENIED.
 *   - Maps JS `StreetViewService.getPanorama()` needs nothing enabled, but Google documents
 *     "Dynamic Street View is billed per panorama" and does not say metadata-only requests are
 *     exempt. A dozen silent billed calls per snapshot is not worth an opening compass bearing.
 *
 * So the camera lands in the right place (verified: Kent St at Bullaburra, Albany Creek Rd at
 * Aspley, both straight onto the correct street) facing an arbitrary direction, and the operator
 * drags once. If exact facing is ever wanted, enable the Static API and pass a heading — the URL
 * side of that is one extra searchParam here.
 */
export function streetViewUrl(at: LatLng): string {
  const url = new URL("https://www.google.com/maps/@");
  url.searchParams.set("api", "1");
  url.searchParams.set("map_action", "pano");
  // Percent-encoded to %2C by URLSearchParams, exactly as Google's own documented example is.
  url.searchParams.set("viewpoint", `${at.lat.toFixed(6)},${at.lng.toFixed(6)}`);
  return url.toString();
}
