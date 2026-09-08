// A deep link into Google Street View, at a point on the ground.
//
// The parse half of this job lives next door in parse-google-maps-url.ts, which reads a URL an
// operator pasted in. This writes one.

import type { LatLng } from "@/lib/kml/types";

/**
 * Street View, opened at the panorama nearest to `at` and — given a heading — looking at it.
 *
 * ⚠️ **The heading is not optional decoration; without it the camera faces an arbitrary
 * direction.** Google's Maps URLs reference claims that with `heading` absent, "a default
 * heading is chosen based on the viewpoint (if specified) of the query and the actual location
 * of the image". The desktop web client does not do that. Tested 2026-09-08 at Newport: two
 * viewpoints 30 m apart on OPPOSITE bearings from the same camera produced a byte-identical
 * canonical URL — `3a,90y,90t`, no `h` term, `yaw=0`, due north both times. Passing
 * `heading=107` was honoured exactly (`107h`). So the parameter works and nothing derives one.
 *
 * `/api/maps/street-view` is what supplies it: the Street View Static API's metadata endpoint
 * gives the camera's real position (free — no quota consumed) and the bearing to `at` is
 * computed from there. It is a separate round trip, so callers pass `heading` in once it
 * arrives and the link works unaimed in the meantime.
 *
 * Six decimals is ~0.11 m, well inside the accuracy of a cadastre outline.
 */
export function streetViewUrl(at: LatLng, heading?: number | null): string {
  const url = new URL("https://www.google.com/maps/@");
  url.searchParams.set("api", "1");
  url.searchParams.set("map_action", "pano");
  // Percent-encoded to %2C by URLSearchParams, exactly as Google's own documented example is.
  url.searchParams.set("viewpoint", `${at.lat.toFixed(6)},${at.lng.toFixed(6)}`);
  if (heading !== undefined && heading !== null && Number.isFinite(heading)) {
    url.searchParams.set("heading", String(Math.round(heading * 10) / 10));
  }
  return url.toString();
}
