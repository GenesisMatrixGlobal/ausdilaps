// A frame in, a satellite photograph out — the backdrop you drop defect pins onto when there
// is no sketch to read and no plan worth drawing.
//
// The frame comes from a live map the operator pointed themselves (see frame-picker.tsx), so
// there is no geocoding and no zoom guess here. lib/floor-plan/frame.ts turns that view into
// a Static Maps request that reproduces it exactly, by holding the integer zoom and solving
// for the SIZE rather than rounding the zoom.
//
// Fetched SERVER-side and returned as a data URL, for three reasons at once: the Static Maps
// key stays off the client, the browser never has to deal with a cross-origin image (which
// would taint the export canvas and silently break the PNG), and the picture travels inside
// the saved .json so reopening a plan months later for the POST survey still shows it.
//
// Resolution is Google's ceiling, not ours: `size` caps at 640 per side on a standard
// account and `scale=2` doubles the pixels without counting against it. Framing tighter buys
// real detail (a deeper zoom fits, so metres-per-pixel improves); framing wider spends it.
// Stitching several tiles into one larger image is NOT an option — each one carries Google's
// attribution baked into its bottom edge, which would land in the middle of the picture.

import { recordApiCall } from "@/lib/api-usage";
import { boundsOfFrame, frameForBounds, type Bounds, type Frame } from "@/lib/floor-plan/frame";

const STATIC_MAP_URL = "https://maps.googleapis.com/maps/api/staticmap";

/** Doubles the delivered pixels. Free of the 640 cap, which applies to `size` only. */
const SCALE = 2;

export type Aerial = {
  /** The image itself, inlined. */
  src: string;
  w: number;
  h: number;
  /** What the operator was looking at, so a wrong one is visible rather than assumed. */
  label: string;
  /** The request that produced it — what a reframe reopens on, and what puts pins on the
   *  ground. Exact, not the bounds that were asked for. */
  frame: Frame;
  bounds: Bounds;
};

export type AerialOutcome =
  | { status: "ok"; aerial: Aerial }
  | { status: "not_configured" }
  | { status: "failed"; detail: string };

export function aerialConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

export async function fetchAerial(bounds: Bounds, label: string): Promise<AerialOutcome> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { status: "not_configured" };

  const frame = frameForBounds(bounds);
  const params = new URLSearchParams({
    center: `${frame.centre.lat},${frame.centre.lng}`,
    zoom: String(frame.zoom),
    size: `${frame.width}x${frame.height}`,
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
        w: frame.width * SCALE,
        h: frame.height * SCALE,
        label,
        frame,
        bounds: boundsOfFrame(frame),
      },
    };
  } catch (err) {
    return { status: "failed", detail: err instanceof Error ? err.message : "Could not reach Google." };
  }
}
