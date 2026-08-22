// Turns a pasted Google Maps directions URL into the ordered waypoints it was built from.
//
// The human-readable part of the URL is unreliable: paste coordinates into Google Maps and
// it relabels them as place names, so `/maps/dir/Murray+Bridge+SA/Mannum+SA/...` can carry
// no coordinates at all. The coordinates do survive, in the `data=` blob, as one block per
// waypoint:
//
//     !1m<n>!2m2!1d<lng>!2d<lat>
//
// A waypoint may additionally carry the *place Google resolved it to*, nested inside it:
//
//     !3m4!1m2!1d<lng>!2d<lat>!3s<placeId>
//
// That resolved place is NOT the waypoint — in live testing it sat 2.2km away from the
// coordinate the user actually entered. The `!2m2` immediately after `!1m<n>` is what
// separates the two (the nested block goes straight to `!1d`), so that part of the pattern
// is load-bearing: relaxing it silently moves points.
//
// `data=` is an undocumented encoding, so it's fenced in: the strict pattern above, a
// cross-check against any coordinates still visible in the path, Australia bounds on every
// point, and a waypoint cap. A grammar change should surface as an error, never a wrong map.

import type { LatLng } from "@/lib/kml/types";
import { CoordinateParseError, normaliseAuPoint, parseLatLng } from "./parse-latlng";

/** Hosts we'll follow a redirect from. Anything else is refused rather than fetched. */
const SHORTLINK_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "www.goo.gl"]);
const GOOGLE_MAPS_HOSTS = /(^|\.)google\.[a-z.]+$/i;

/** Directions API takes an origin, a destination and up to 23 stops in between. */
const MAX_WAYPOINTS = 25;

const SHORTLINK_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;

/** One waypoint block: `!1m<n>!2m2!1d<lng>!2d<lat>`. Longitude precedes latitude. */
const WAYPOINT_BLOCK = /!1m\d+!2m2!1d(-?\d+(?:\.\d+)?)!2d(-?\d+(?:\.\d+)?)/g;

export interface ParsedRoute {
  /** Waypoints in travel order, origin first. */
  points: LatLng[];
  flags: string[];
}

function isShortlink(url: URL): boolean {
  return SHORTLINK_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Expands a Share-button short link by following its redirects. Every hop is re-checked
 * against the host allowlist, so a redirect can't walk this off Google's domains and turn
 * the endpoint into a general-purpose fetcher.
 */
async function expandShortlink(url: URL): Promise<URL> {
  let current = url;

  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SHORTLINK_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, { redirect: "manual", signal: controller.signal });
    } catch (e) {
      throw new CoordinateParseError(
        `Couldn't open that shortened link (${(e as Error).message}). Open it in a browser and paste the full URL instead.`
      );
    } finally {
      clearTimeout(timer);
    }

    const location = res.headers.get("location");
    if (!location) {
      throw new CoordinateParseError(
        "That shortened link didn't redirect anywhere. Open it in a browser and paste the full URL instead."
      );
    }

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new CoordinateParseError("That shortened link redirected somewhere unreadable.");
    }
    if (!GOOGLE_MAPS_HOSTS.test(next.hostname) && !isShortlink(next)) {
      throw new CoordinateParseError("That shortened link redirected off Google Maps — not following it.");
    }

    if (!isShortlink(next)) return next;
    current = next;
  }

  throw new CoordinateParseError("That shortened link redirected too many times.");
}

/** Waypoints out of the `data=` blob — the source that survives Google relabelling. */
function fromDataBlob(pathname: string): { lat: number; lng: number }[] {
  const segment = pathname.split("/").find((s) => s.startsWith("data="));
  if (!segment) return [];
  return [...segment.matchAll(WAYPOINT_BLOCK)].map((m) => ({
    lng: Number(m[1]),
    lat: Number(m[2]),
  }));
}

/** Coordinates still visible in the `/dir/` path, used only to cross-check the blob. */
function fromPathSegments(pathname: string): { lat: number; lng: number }[] {
  const parts = pathname.split("/").filter(Boolean);
  const dirIndex = parts.indexOf("dir");
  if (dirIndex === -1) return [];

  const points: { lat: number; lng: number }[] = [];
  for (const raw of parts.slice(dirIndex + 1)) {
    // `@lat,lng,zoom` is where the map was looking, not a waypoint.
    if (raw.startsWith("@") || raw.startsWith("data=")) continue;
    // '+' is an encoded space in a path segment: "-34.82,+139.07" -> "-34.82, 139.07".
    const decoded = decodeURIComponent(raw.replace(/\+/g, " "));
    try {
      points.push(parseLatLng(decoded).point);
    } catch {
      // A place name rather than a coordinate — expected, and why the blob is primary.
    }
  }
  return points;
}

function samePoint(a: LatLng, b: LatLng): boolean {
  // The blob rounds to 7dp while the path can carry more; well inside a metre either way.
  return Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;
}

/** Throws CoordinateParseError with a message written for the person who pasted it. */
export async function parseGoogleRouteUrl(raw: string): Promise<ParsedRoute> {
  const trimmed = raw.trim();
  if (!trimmed) throw new CoordinateParseError("Paste a Google Maps directions link.");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new CoordinateParseError(
      "That doesn't look like a link. Copy the whole URL out of your browser's address bar."
    );
  }

  if (isShortlink(url)) url = await expandShortlink(url);

  if (!GOOGLE_MAPS_HOSTS.test(url.hostname)) {
    throw new CoordinateParseError(`${url.hostname} isn't a Google Maps link.`);
  }
  if (!url.pathname.split("/").includes("dir")) {
    throw new CoordinateParseError(
      "That's a Google Maps link, but not a directions one — build the route with the Directions button first, then copy the URL."
    );
  }

  const flags: string[] = [];
  const blobPoints = fromDataBlob(url.pathname);
  const pathPoints = fromPathSegments(url.pathname);

  // The blob wins: it's the only source that survives Google relabelling waypoints.
  const chosen = blobPoints.length >= 2 ? blobPoints : pathPoints;
  if (blobPoints.length < 2 && pathPoints.length >= 2) {
    flags.push("read the waypoints from the link's visible path — its encoded data was unreadable");
  }

  if (chosen.length < 2) {
    throw new CoordinateParseError(
      `Only found ${chosen.length} waypoint${chosen.length === 1 ? "" : "s"} in that link — a route needs at least two.`
    );
  }
  if (chosen.length > MAX_WAYPOINTS) {
    throw new CoordinateParseError(
      `That route has ${chosen.length} waypoints; Google can route through at most ${MAX_WAYPOINTS}. Split it into shorter runs.`
    );
  }

  const points: LatLng[] = [];
  for (const [i, candidate] of chosen.entries()) {
    if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) {
      throw new CoordinateParseError(`Waypoint ${i + 1} in that link isn't a readable coordinate.`);
    }
    const { point, flags: pointFlags } = normaliseAuPoint(candidate.lat, candidate.lng);
    points.push(point);
    flags.push(...pointFlags.map((f) => `Waypoint ${i + 1}: ${f}`));
  }

  // Sanity check, not a gate: if the path still showed coordinates they should agree with
  // the blob. Disagreement means the encoding shifted under us — flag, don't fail.
  if (blobPoints.length >= 2 && pathPoints.length >= 2) {
    const aligned =
      pathPoints.length === points.length && pathPoints.every((p, i) => samePoint(p, points[i]));
    if (!aligned) {
      flags.push("the link's visible waypoints don't match its encoded ones — check the route on the image");
    }
  }

  return { points, flags };
}
