// How many storeys is this property? Street View + vision, for the sheet's Levels cell.
//
// There is no usable height data outside one council's LiDAR (lib/property-sizing/building.ts),
// so the answer comes from looking at the building: ONE Street View Static image aimed at the
// property, judged by a vision model. Proven on the North Richmond job (scripts/trial-storeys.ts,
// 2026-09-14) before it was wired in here.
//
// ⚠️ The camera has to be Google's STREET camera standing OUTSIDE the property. By coordinate the
// nearest panorama is often a business's own indoor photosphere — `source=outdoor` does not
// exclude them and some even carry "© Google" — and a wrong image produces a CONFIDENT wrong
// answer (a two-storey vet came back "1 storey @80%" off a shop interior). So the target point
// and a ring of offsets around it are each asked for their nearest panorama, and the closest
// Google camera outside the parcel ring wins. Metadata calls are free; the image is ~0.7c.
//
// Never throws for an ordinary miss — no coverage, no camera outside the parcel — those are
// answers. A failed vision call throws and the caller records it as unchecked.

import type { LatLng } from "@/lib/kml/types";
import { pointInRing, projectToLocalMetres } from "@/lib/kml/standard-markup/geometry";
import { recordApiCall, type AnthropicUsage } from "@/lib/api-usage";

export const STOREYS_MODEL = process.env.STOREYS_MODEL ?? "claude-sonnet-5";
/** At or above this the Levels cell is filled and NOT highlighted; below it the operator has to
 *  look. Rhys, 2026-09-14: 75 after auditing the trial, then 70 once the check could try more
 *  than one camera. */
export const STOREYS_CONFIDENT = 70;
/** How many distinct street cameras to try before giving up and leaving the cell highlighted.
 *  Trees and awnings block one angle far more often than several; each extra try is one more
 *  image (~0.7c) and one more vision call (~0.2c), paid only by the lots that need it. */
export const STOREYS_MAX_ANGLES = 5;
/** Two cameras closer together than this see the same facade from the same place. */
const MIN_CAMERA_SEPARATION_M = 12;

export interface StoreyVerdict {
  storeys: number | null;
  /** 0–100 */
  confidence: number;
  facadeVisible: boolean;
  buildingType: string;
  notes: string;
  /** Confident enough to fill the cell without a highlight. */
  clear: boolean;
  cameraDistanceM: number;
  /** How many cameras were tried before this verdict (1 = the first one was enough). */
  attempts: number;
}

export type StoreyResult =
  | { status: "ok"; verdict: StoreyVerdict }
  | { status: "no_street_view" }
  | { status: "no_point" };

interface Meta {
  status?: string;
  copyright?: string;
  location?: { lat: number; lng: number };
  pano_id?: string;
}

async function metadata(location: string, key: string): Promise<Meta> {
  const params = new URLSearchParams({ location, radius: "70", source: "outdoor", key });
  const res = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?${params}`);
  void recordApiCall({ provider: "google", api: "street_view_metadata" });
  return (await res.json()) as Meta;
}

interface Camera {
  lat: number;
  lng: number;
  heading: number;
  distanceM: number;
  pano?: string;
}

/** Google street cameras standing outside the parcel, nearest first, no two within
 *  MIN_CAMERA_SEPARATION_M of each other — see the header for why the parcel test matters.
 *  The target and three rings of offsets (25, 45, 70 m in four directions) are each asked for
 *  their nearest panorama; all metadata calls are free. */
export async function findStreetCameras(target: LatLng, parcel: LatLng[] | null, key: string, max = STOREYS_MAX_ANGLES): Promise<Camera[]> {
  const offsets: LatLng[] = [target];
  for (const r of [25, 45, 70]) {
    const dLat = r / 111_320;
    const dLng = dLat / Math.cos((target.lat * Math.PI) / 180);
    offsets.push(
      { lat: target.lat + dLat, lng: target.lng },
      { lat: target.lat - dLat, lng: target.lng },
      { lat: target.lat, lng: target.lng + dLng },
      { lat: target.lat, lng: target.lng - dLng }
    );
  }
  const seen = new Set<string>();
  const found: Camera[] = [];
  for (const o of offsets) {
    const data = await metadata(`${o.lat.toFixed(7)},${o.lng.toFixed(7)}`, key);
    if (data.status !== "OK" || !data.location || !/google/i.test(data.copyright ?? "")) continue;
    if (data.pano_id && seen.has(data.pano_id)) continue;
    if (data.pano_id) seen.add(data.pano_id);
    if (parcel && parcel.length >= 3 && pointInRing(data.location, parcel)) continue; // indoors, or in the yard
    const { east, north } = projectToLocalMetres(data.location, target);
    const distanceM = Math.hypot(east, north);
    if (distanceM < 5) continue;
    const cam: Camera = { lat: data.location.lat, lng: data.location.lng, heading: ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360, distanceM, pano: data.pano_id };
    // Same spot as one we already have (a different pano id at the same kerb) is not an angle.
    if (found.some((f) => { const d = projectToLocalMetres(f, cam); return Math.hypot(d.east, d.north) < MIN_CAMERA_SEPARATION_M; })) continue;
    found.push(cam);
  }
  return found.sort((a, b) => a.distanceM - b.distanceM).slice(0, max);
}

/** The single nearest camera — what the trial and the Street View link want. */
export async function findStreetCamera(target: LatLng, parcel: LatLng[] | null, key: string): Promise<Camera | null> {
  return (await findStreetCameras(target, parcel, key, 1))[0] ?? null;
}

/** The one billed call: a 640x480 frame from the camera, aimed at the property. */
export async function streetViewImage(cam: Camera, key: string): Promise<Buffer> {
  const params = new URLSearchParams({
    size: "640x480",
    heading: cam.heading.toFixed(1),
    fov: "75",
    pitch: "8",
    source: "outdoor",
    key,
    ...(cam.pano ? { pano: cam.pano } : { location: `${cam.lat},${cam.lng}` }),
  });
  const res = await fetch(`https://maps.googleapis.com/maps/api/streetview?${params}`);
  void recordApiCall({ provider: "google", api: "street_view_static" });
  if (!res.ok) throw new Error(`Street View image ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

interface RawVerdict {
  storeys?: unknown;
  confidence?: unknown;
  facade_visible?: unknown;
  building_type?: unknown;
  notes?: unknown;
}

export async function judgeStoreys(imageBase64: string, label: string, key: string): Promise<Omit<StoreyVerdict, "clear" | "cameraDistanceM" | "attempts">> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: STOREYS_MODEL,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
            {
              type: "text",
              text:
                `This is a Google Street View photo aimed at the property "${label}" (Australia). ` +
                `The property of interest should be roughly in the centre of the frame. Count its above-ground storeys (habitable levels; a garage under a house counts as a level). ` +
                `Reply with JSON only: {"storeys": <integer or null if you cannot tell>, "confidence": <0-100>, "facade_visible": <true if you can see most of the building's front>, ` +
                `"building_type": "house" | "units" | "commercial" | "vacant" | "other", "notes": "<one short sentence>"}. ` +
                `Be conservative: if trees, fences, distance or angle hide the upper part of the building, lower the confidence.`,
            },
          ],
        },
      ],
    }),
  });
  const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: AnthropicUsage; error?: { message?: string } };
  void recordApiCall({ provider: "anthropic", api: "messages", model: STOREYS_MODEL, usage: data.usage });
  if (!res.ok) throw new Error(data.error?.message ?? `vision ${res.status}`);
  const text = data.content?.find((c) => c.type === "text")?.text ?? "";
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error(`no JSON in: ${text.slice(0, 120)}`);
  const v = JSON.parse(json) as RawVerdict;
  return {
    storeys: typeof v.storeys === "number" && Number.isFinite(v.storeys) ? Math.round(v.storeys) : null,
    confidence: typeof v.confidence === "number" ? Math.max(0, Math.min(100, v.confidence)) : 0,
    facadeVisible: Boolean(v.facade_visible),
    buildingType: String(v.building_type ?? "other"),
    notes: String(v.notes ?? ""),
  };
}

export function isConfident(v: { storeys: number | null; confidence: number; facadeVisible: boolean }): boolean {
  return v.storeys !== null && v.storeys >= 1 && v.confidence >= STOREYS_CONFIDENT && v.facadeVisible;
}

/** The whole thing for one property: up to STOREYS_MAX_ANGLES cameras, nearest first, stopping
 *  at the first confident verdict. When none is confident the BEST guess (highest confidence)
 *  is returned unclear, so the sheet shows a count but keeps the cell highlighted. `onImage`
 *  is called for every frame judged, with the attempt number, for callers that keep them. */
export async function estimateStoreys(
  input: { target: LatLng | null; parcel: LatLng[] | null; label: string },
  keys: { maps: string; anthropic: string },
  onImage?: (jpeg: Buffer, attempt: number) => void
): Promise<StoreyResult> {
  if (!input.target) return { status: "no_point" };
  const cameras = await findStreetCameras(input.target, input.parcel, keys.maps);
  if (cameras.length === 0) return { status: "no_street_view" };
  let best: StoreyVerdict | null = null;
  for (let i = 0; i < cameras.length; i++) {
    const cam = cameras[i];
    const jpeg = await streetViewImage(cam, keys.maps);
    onImage?.(jpeg, i + 1);
    const v = await judgeStoreys(jpeg.toString("base64"), input.label, keys.anthropic);
    const verdict: StoreyVerdict = { ...v, clear: isConfident(v), cameraDistanceM: cam.distanceM, attempts: i + 1 };
    if (verdict.clear) return { status: "ok", verdict };
    // A verdict with a count beats one without; among those, the more confident.
    if (!best || (verdict.storeys !== null && best.storeys === null) || (verdict.storeys !== null) === (best.storeys !== null) && verdict.confidence > best.confidence) {
      best = verdict;
    }
  }
  return { status: "ok", verdict: { ...best!, attempts: cameras.length } };
}
