// An address in, a satellite photograph out — the backdrop you drop defect pins onto when
// there is no sketch to read and no plan worth drawing.
//
// Fetched SERVER-side and returned as a data URL, for three reasons at once: the Static Maps
// key stays off the client, the browser never has to deal with a cross-origin image (which
// would taint the export canvas and silently break the PNG), and the picture travels inside
// the saved .json so reopening a plan months later for the POST survey still shows it.
//
// RESOLUTION IS THE LIMIT HERE, and it is Google's, not ours. Static Maps caps `size` at
// 640x640 on a standard account; `scale=2` doubles the pixels without counting against that
// cap, so the largest A4-portrait-shaped image available is 490x640 @2 = 980x1280. On an A4
// sheet at 300 DPI the content area is about 2140x2790, so it is upscaled a little over 2x
// and looks soft. The pins stay vector and stay sharp. When that is not good enough, upload
// your own aerial screenshot instead — that path takes whatever resolution you give it.

import { geocodeViaGoogle } from "@/lib/property-sizing/google-geocode";
import { AERIAL_ZOOM } from "@/lib/floor-plan/types";
import { recordApiCall } from "@/lib/api-usage";

const STATIC_MAP_URL = "https://maps.googleapis.com/maps/api/staticmap";

/** Shaped to A4 portrait's content area, so the picture fills the page rather than banding it. */
const TILE_W = 490;
const TILE_H = 640;
const SCALE = 2;

/**
 * Zoom 19 frames a suburban lot with its neighbours, which is the usual dilapidation job.
 *
 * The floor is deliberately a long way below that. A job is not always one house — a strata
 * block, a row of terraces, a school, or a defect on the far side of a construction site all
 * need the street and its neighbours in frame, and at 19 you cannot get them. 12 is a whole
 * suburb, well past anything useful, which is the point: the limit should never be the thing
 * you hit. 21 is the ceiling because that is about as far as Australian imagery holds detail.
 */
export const DEFAULT_ZOOM = AERIAL_ZOOM.default;
export const MIN_ZOOM = AERIAL_ZOOM.min;
export const MAX_ZOOM = AERIAL_ZOOM.max;

export type Centre = { lat: number; lng: number };

export type Aerial = {
  /** The image itself, inlined. */
  src: string;
  w: number;
  h: number;
  /** What Google matched, so a wrong address is visible rather than assumed. */
  label: string;
  /** Kept with the picture so it can be re-fetched wider or closer about the same point. */
  centre: Centre;
  zoom: number;
};

export type AerialOutcome =
  | { status: "ok"; aerial: Aerial }
  | { status: "not_configured" }
  | { status: "no_match" }
  | { status: "failed"; detail: string };

export function aerialConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom)));
}

/**
 * The picture at a point we already know.
 *
 * This is the path the address box takes: the Places autocomplete it shares with the other
 * marker tools returns a coordinate with the selection, so geocoding again would be a second
 * billed call to re-derive something we were just handed — and a worse one, because a
 * free-text geocode can land on a different property from the one the operator picked.
 */
export async function fetchAerialAt(
  centre: Centre,
  label: string,
  zoom = DEFAULT_ZOOM
): Promise<AerialOutcome> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { status: "not_configured" };

  const params = new URLSearchParams({
    center: `${centre.lat},${centre.lng}`,
    zoom: String(clampZoom(zoom)),
    size: `${TILE_W}x${TILE_H}`,
    scale: String(SCALE),
    maptype: "satellite",
    format: "jpg",
    key,
  });

  try {
    const res = await fetch(`${STATIC_MAP_URL}?${params.toString()}`);
    void recordApiCall({ provider: "google", api: "static_maps" });
    if (!res.ok) return { status: "failed", detail: `Static Maps returned HTTP ${res.status}.` };

    const bytes = Buffer.from(await res.arrayBuffer());
    return {
      status: "ok",
      aerial: {
        src: `data:image/jpeg;base64,${bytes.toString("base64")}`,
        w: TILE_W * SCALE,
        h: TILE_H * SCALE,
        label,
        centre,
        zoom: clampZoom(zoom),
      },
    };
  } catch (err) {
    return { status: "failed", detail: err instanceof Error ? err.message : "Could not reach Google." };
  }
}

/** The picture at an address, geocoded here. Kept for text that was typed and never picked
 *  out of the autocomplete, and for anything calling this without a coordinate to hand. */
export async function fetchAerial(address: string, zoom = DEFAULT_ZOOM): Promise<AerialOutcome> {
  if (!process.env.GOOGLE_MAPS_API_KEY) return { status: "not_configured" };

  const found = await geocodeViaGoogle(address.trim());
  if (found.status !== "ok") return { status: "no_match" };

  return fetchAerialAt({ lat: found.y, lng: found.x }, found.matchedAddress ?? address.trim(), zoom);
}
