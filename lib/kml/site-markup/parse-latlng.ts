// Parses whatever a field user pastes into a coordinate box into a real LatLng.
//
// The formats below are all ones that turn up in practice: a Google Maps right-click
// copies decimal degrees, GPS units and survey documents print degrees/minutes/seconds,
// and people paste the whole map URL rather than picking the numbers out of it. Parsing
// is deliberately permissive — the alternative is staff hand-editing coordinates into
// the one shape we accept, which is where transcription errors come from.
//
//   -34.0521, 151.1548                              decimal, comma
//   -34.0521 151.1548                               decimal, whitespace
//   34.0521 S, 151.1548 E                           decimal with hemispheres
//   34°03'07.6"S 151°09'17.3"E                       degrees/minutes/seconds
//   https://www.google.com/maps/@-34.0521,151.1548,18z    pasted map URL
//   https://maps.google.com/?q=-34.0521,151.1548         pasted share link

import type { LatLng } from "@/lib/kml/types";

/** Mainland + Tasmania, generously bounded. Used to reject nonsense and to detect the
 *  one transposition that is unambiguous in Australia (see `normalise`). */
const AU_LAT = { min: -44, max: -9 };
const AU_LNG = { min: 112, max: 154 };

export class CoordinateParseError extends Error {}

export interface ParsedPoint {
  point: LatLng;
  /** Advisory notes to surface alongside the generated image (e.g. an auto-corrected swap). */
  flags: string[];
}

function inRange(value: number, range: { min: number; max: number }): boolean {
  return value >= range.min && value <= range.max;
}

/**
 * Google Maps URLs carry two different points: `q=`/`query=` is the place the link is
 * *about*, while `@lat,lng,zoom` is only where the viewport happened to be sitting. Prefer
 * the former and fall back to the latter.
 */
function extractFromUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return null;

  // Short links resolve server-side to the real URL — we can't read the coordinates out
  // of the slug, so say so rather than failing with a generic "couldn't parse".
  if (/goo\.gl|maps\.app\./i.test(value)) {
    throw new CoordinateParseError(
      "Shortened Google Maps links don't contain the coordinates — open the link, right-click the point, and copy the numbers."
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const param = url.searchParams.get("q") ?? url.searchParams.get("query") ?? url.searchParams.get("ll");
  if (param && /-?\d/.test(param)) return param;

  const at = url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) return `${at[1]},${at[2]}`;

  return null;
}

const HEMISPHERE = /([NSEW])/i;

/** Applies a hemisphere letter, and validates it belongs on this axis. */
function signFor(magnitude: number, hemisphere: string | undefined, axis: "lat" | "lng"): number {
  if (!hemisphere) return magnitude;
  const h = hemisphere.toUpperCase();
  const isLatLetter = h === "N" || h === "S";
  if (isLatLetter !== (axis === "lat")) {
    throw new CoordinateParseError(
      `"${h}" is on the wrong side of that coordinate — latitude takes N/S and longitude takes E/W.`
    );
  }
  return h === "S" || h === "W" ? -Math.abs(magnitude) : Math.abs(magnitude);
}

/** Degrees/minutes/seconds. Only attempted when a °, ′ or ″ marker is present, so it can't
 *  swallow a plain decimal pair. Minutes and seconds are both optional. */
function parseDms(value: string): { lat: number; lng: number } | null {
  if (!/[°º'′"″]/.test(value)) return null;

  const component =
    /(\d+(?:\.\d+)?)\s*[°º]\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?\s*([NSEW])?/gi;
  const found = [...value.matchAll(component)];
  if (found.length < 2) return null;

  const toDecimal = (m: RegExpMatchArray, axis: "lat" | "lng"): number => {
    const deg = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const sec = m[3] ? Number(m[3]) : 0;
    if (min >= 60 || sec >= 60) {
      throw new CoordinateParseError("Minutes and seconds must each be under 60.");
    }
    return signFor(deg + min / 60 + sec / 3600, m[4], axis);
  };

  return { lat: toDecimal(found[0], "lat"), lng: toDecimal(found[1], "lng") };
}

/** Two signed decimals separated by a comma, semicolon or whitespace, each optionally
 *  carrying a hemisphere letter. */
function parseDecimalPair(value: string): { lat: number; lng: number } | null {
  // Glue a hemisphere letter onto its number first. Whitespace doubles as a field
  // separator here, so "34.0521 S, 151.1548 E" would otherwise split into four fields
  // instead of two. Handles the letter on either side of the number.
  const glued = value.replace(/(\d)\s+([NSEW])\b/gi, "$1$2").replace(/\b([NSEW])\s+(\d)/gi, "$1$2");

  const parts = glued
    .split(/\s*[,;]\s*|\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;

  const read = (part: string, axis: "lat" | "lng"): number => {
    const hemisphere = part.match(HEMISPHERE)?.[1];
    const numeric = part.replace(HEMISPHERE, "").trim();
    if (!/^[-+]?\d+(?:\.\d+)?$/.test(numeric)) {
      throw new CoordinateParseError(`"${part}" isn't a number.`);
    }
    return signFor(Number(numeric), hemisphere, axis);
  };

  return { lat: read(parts[0], "lat"), lng: read(parts[1], "lng") };
}

/**
 * Range-checks the pair, and fixes the one mistake worth fixing automatically: a
 * transposed lat/lng. In Australia the two ranges don't overlap (latitude is always
 * negative, longitude always positive and >112), so a swapped pair is unambiguous rather
 * than a guess — but it's still flagged so the operator sees what happened.
 *
 * Exported so callers holding already-numeric coordinates (route URLs, where the numbers
 * come out of the URL's own encoding rather than a text box) get the same validation.
 */
export function normaliseAuPoint(lat: number, lng: number): ParsedPoint {
  if (inRange(lat, AU_LAT) && inRange(lng, AU_LNG)) {
    return { point: { lat, lng }, flags: [] };
  }

  if (inRange(lng, AU_LAT) && inRange(lat, AU_LNG)) {
    return {
      point: { lat: lng, lng: lat },
      flags: [`latitude and longitude were the wrong way round — read as ${lng}, ${lat}`],
    };
  }

  throw new CoordinateParseError(
    `${lat}, ${lng} isn't in Australia (expected latitude ${AU_LAT.min} to ${AU_LAT.max}, longitude ${AU_LNG.min} to ${AU_LNG.max}).`
  );
}

/** Throws CoordinateParseError with a message written for the person who pasted it. */
export function parseLatLng(raw: string): ParsedPoint {
  const trimmed = raw.trim();
  if (!trimmed) throw new CoordinateParseError("Enter a coordinate.");

  const value = extractFromUrl(trimmed) ?? trimmed;
  const pair = parseDms(value) ?? parseDecimalPair(value);

  if (!pair) {
    throw new CoordinateParseError(
      `Couldn't read "${trimmed}" as a coordinate. Use a decimal pair like -34.0521, 151.1548.`
    );
  }
  if (!Number.isFinite(pair.lat) || !Number.isFinite(pair.lng)) {
    throw new CoordinateParseError(`Couldn't read "${trimmed}" as a coordinate.`);
  }

  return normaliseAuPoint(pair.lat, pair.lng);
}
