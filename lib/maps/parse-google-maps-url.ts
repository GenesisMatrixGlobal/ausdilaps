/**
 * Reads a location out of a Google Maps URL pasted from the browser address bar.
 *
 * Pure and dependency-free so it runs identically on the client (where the paste happens)
 * and in the short-link resolver route (which parses the URL it was redirected to).
 *
 * There is no documented format here — these are the shapes Google actually emits, so the
 * parser is deliberately forgiving and every branch is ordered by how much it can be
 * trusted about what the operator was looking at.
 */

export type GoogleMapsTarget =
  /** A point to fly to. `zoom` is null when the URL carried no usable zoom.
   *
   *  A `/maps/place/<name>/@…` link also says WHAT was looked at, and where: `placeName` is the
   *  path segment, `pin` the selected feature's own point (`!3d…!4d…` — the @ is only the view
   *  centre, which can sit on the lot across the road), and `spanMetres` the `…,291m` camera
   *  height, which is how Google writes the zoom on a satellite view. All optional; a bare
   *  `@lat,lng,17z` link has none of them. */
  | {
      kind: "coords";
      lat: number;
      lng: number;
      zoom: number | null;
      placeName?: string;
      pin?: { lat: number; lng: number };
      spanMetres?: number;
    }
  /** A place NAME rather than a coordinate — hand it to the address search instead. */
  | { kind: "query"; query: string }
  /** A maps.app.goo.gl share link. Only a redirect can say where it points, so this has
   *  to go through /api/maps/resolve-link. */
  | { kind: "shortlink"; url: string };

const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "www.goo.gl"]);

function validCoords(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    // 0,0 is in the Atlantic and is overwhelmingly more likely to be a parse artefact
    // (an empty capture coerced to a number) than somewhere anyone means to measure.
    !(lat === 0 && lng === 0)
  );
}

/** Clamped to the map's own useful range. A `...,3z` continent view and a `...,25z` link
 *  from Earth are both real, and neither is a measuring zoom. */
function cleanZoom(raw: string | undefined): number | null {
  if (!raw) return null;
  const z = Number(raw);
  if (!Number.isFinite(z)) return null;
  return Math.min(21, Math.max(3, Math.round(z)));
}

function coords(lat: number, lng: number, zoom: number | null): GoogleMapsTarget | null {
  return validCoords(lat, lng) ? { kind: "coords", lat, lng, zoom } : null;
}

/** Matches a bare "-27.4698, 153.0251" paste — copying a coordinate pair straight out of
 *  Google's place card is at least as common as copying the whole URL. */
const BARE_PAIR = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/;

export function parseGoogleMapsUrl(input: string): GoogleMapsTarget | null {
  const text = input.trim();
  if (!text) return null;

  const bare = BARE_PAIR.exec(text);
  if (bare) return coords(Number(bare[1]), Number(bare[2]), null);

  let url: URL;
  try {
    // Tolerate a paste with the scheme stripped, which is what some chat clients do.
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }

  if (SHORT_HOSTS.has(url.hostname)) return { kind: "shortlink", url: url.toString() };

  // Anything else has to look like Google Maps. Without this a random pasted URL would
  // fall through the query branch below and be sent to Places as a search term.
  if (!/(^|\.)google\.[a-z.]+$/i.test(url.hostname)) return null;

  const whole = url.toString();

  // 1. The view centre: /@lat,lng,17z (or ,1000m from an Earth link, or ,17.5z).
  //    Preferred over everything else because it is literally the frame on screen when
  //    the operator hit copy.
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)([zm]))?/.exec(whole);
  if (at) {
    const hit = coords(Number(at[1]), Number(at[2]), at[4] === "z" ? cleanZoom(at[3]) : null);
    if (hit && hit.kind === "coords") {
      const span = at[4] === "m" ? Number(at[3]) : NaN;
      if (Number.isFinite(span) && span > 0) hit.spanMetres = span;
      const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(whole);
      if (pin && validCoords(Number(pin[1]), Number(pin[2]))) hit.pin = { lat: Number(pin[1]), lng: Number(pin[2]) };
      const name = placeNameFrom(url.pathname);
      if (name) hit.placeName = name;
      return hit;
    }
  }

  // 2. The dropped pin inside the data blob: !3d<lat>!4d<lng>. Present when a place is
  //    selected, and it is the pin rather than the view — used only if there was no @.
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(whole);
  if (pin) {
    const hit = coords(Number(pin[1]), Number(pin[2]), null);
    if (hit) return hit;
  }

  // 3. The query parameters, in the order Google prefers them.
  for (const key of ["q", "query", "ll", "center", "daddr"]) {
    const value = url.searchParams.get(key);
    if (!value) continue;
    const pair = BARE_PAIR.exec(value);
    if (pair) {
      const hit = coords(Number(pair[1]), Number(pair[2]), cleanZoom(url.searchParams.get("z") ?? undefined));
      if (hit) return hit;
    }
    // A name, not a coordinate ("q=Story+Bridge"). Only the Places search can turn that
    // into a point, so hand it back as text rather than guessing.
    const named = value.replace(/\+/g, " ").trim();
    if (named) return { kind: "query", query: named };
  }

  // 4. /maps/place/Story+Bridge/... with no coordinates anywhere — same as above.
  const named = placeNameFrom(url.pathname);
  if (named) return { kind: "query", query: named };

  return null;
}

/** The `/maps/place/<name>` segment as text, or null. */
function placeNameFrom(pathname: string): string | null {
  const place = /\/maps\/place\/([^/@?]+)/.exec(pathname);
  if (!place) return null;
  try {
    return decodeURIComponent(place[1]).replace(/\+/g, " ").trim() || null;
  } catch {
    // A malformed escape sequence in the path is not worth failing the paste over.
    return null;
  }
}

/** True for anything worth trying to parse as a link, so the address box can tell a paste
 *  from someone typing a street name and skip the Places round trip. */
export function looksLikeMapsPaste(input: string): boolean {
  const text = input.trim();
  return BARE_PAIR.test(text) || /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(text);
}
