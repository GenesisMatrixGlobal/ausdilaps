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
import { closeRing, minDistanceBetween, pointInRing, projectToLocalMetres } from "@/lib/kml/standard-markup/geometry";
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
/** Beyond this FROM THE PARCEL BOUNDARY the frame holds several buildings and the model counts
 *  the wrong one — the two-storey vet at 30 Bells Line of Road was outvoted 3–1 by cameras
 *  50–70 m away looking at the warehouse next door. Measured to the boundary, not the lot's
 *  centre: a camera at the kerb of a deep lot is a fine view even 60 m from its middle, and a
 *  first cut measured from the centre threw six good views away. */
export const MAX_CAMERA_DISTANCE_M = 45;
/** The nearest camera's count can be wrong, but it cannot be OUTVOTED: if it saw the facade
 *  with at least this much confidence and the others disagree, the cell stays highlighted. */
export const NEAREST_CAMERA_VETO_AT = 40;
/** A dissenting count at or above this is a real disagreement, not noise, and blocks a clear. */
export const DISSENT_MATTERS_AT = 50;
/** The agreeing angles must average at least this to clear — two shaky agreements are not proof. */
export const AGREEMENT_MIN_MEAN = 60;

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
  /** To the target point (the lot's anchor). */
  distanceM: number;
  /** To the parcel boundary — what "near" means for ranking and the distance cap. Equal to
   *  distanceM when there is no parcel to measure against. */
  edgeDistanceM: number;
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
  const ring = parcel && parcel.length >= 3 ? closeRing(parcel) : null;
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
    const edgeDistanceM = ring ? minDistanceBetween([data.location, data.location], ring) : distanceM;
    if (edgeDistanceM > MAX_CAMERA_DISTANCE_M) continue;
    const cam: Camera = { lat: data.location.lat, lng: data.location.lng, heading: ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360, distanceM, edgeDistanceM, pano: data.pano_id };
    // Same spot as one we already have (a different pano id at the same kerb) is not an angle.
    if (found.some((f) => { const d = projectToLocalMetres(f, cam); return Math.hypot(d.east, d.north) < MIN_CAMERA_SEPARATION_M; })) continue;
    found.push(cam);
  }
  return found.sort((a, b) => a.edgeDistanceM - b.edgeDistanceM).slice(0, max);
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
                `Be conservative: if trees, fences, distance or angle hide the upper part of the building, lower the confidence. ` +
                `If several buildings are in frame and you cannot tell which one is the property, set facade_visible to false and keep the confidence low.`,
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

/** How the angles VOTE. One photo can be wrong with great confidence — a wrong image is the
 *  failure mode this whole module guards against — so a clear needs CORROBORATION:
 *
 *   - clear when two angles that SAW THE FACADE agree on the count, at least one of them is
 *     confident, and they average AGREEMENT_MIN_MEAN or better — or when THREE or more agree at
 *     that average even with none confident (three independent views at 60 are stronger
 *     evidence than one at 70; a service station read 1 storey five times at 60 and stayed
 *     orange under the old rule);
 *   - a lone camera (nothing else to corroborate with) clears only at LONE_CAMERA_CONFIDENT;
 *   - a dissenting count at DISSENT_MATTERS_AT or better blocks a clear — unless it is a single
 *     non-confident dissent outvoted by three or more facade-visible agreeing angles that include
 *     the nearest camera. A disagreement is worth another angle, so it does not stop the search
 *     while cameras remain;
 *   - the NEAREST camera (verdicts arrive nearest first) cannot be outvoted: if it saw the
 *     facade at NEAREST_CAMERA_VETO_AT or better and the winner disagrees with it, no clear;
 *   - the best guess is the count with the most confidence WEIGHT behind it, so one loud
 *     outlier cannot override two quieter agreeing views;
 *   - verdicts with no count (vacant land, unreadable) abstain: they neither vote nor conflict.
 *
 *  Rhys, 2026-09-14: "build in some smart cross checks so the photos don't conflict with each
 *  other and make the confidence rating confused." */
export const LONE_CAMERA_CONFIDENT = 85;

type Judged = Omit<StoreyVerdict, "clear" | "cameraDistanceM" | "attempts">;

export interface Tally {
  /** The winning count, or null when no angle produced one. */
  storeys: number | null;
  /** Combined confidence in the winner — the mean of the agreeing angles' confidences. */
  confidence: number;
  clear: boolean;
  /** Why it is or isn't clear, for the sheet's note. */
  reason: string;
  /** True when it is worth another angle: no corroboration yet and no hard conflict. */
  wantsMore: boolean;
}

export function tallyVerdicts(verdicts: Judged[], camerasAvailable: number): Tally {
  const counted = verdicts.filter((v) => v.storeys !== null && v.storeys >= 1);
  if (counted.length === 0) {
    return { storeys: null, confidence: 0, clear: false, reason: "no angle could count the storeys", wantsMore: verdicts.length < camerasAvailable };
  }
  // Weight per count = summed confidence of the angles that saw it.
  const weight = new Map<number, number>();
  for (const v of counted) weight.set(v.storeys!, (weight.get(v.storeys!) ?? 0) + v.confidence);
  const ranked = [...weight.entries()].sort((a, b) => b[1] - a[1]);
  const [winner] = ranked[0];
  const agreeing = counted.filter((v) => v.storeys === winner);
  // Only an angle that saw the facade can vouch for a count.
  const vouching = agreeing.filter((v) => v.facadeVisible);
  const confidentFor = vouching.filter(isConfident);
  const dissent = counted.filter((v) => v.storeys !== winner && v.confidence >= DISSENT_MATTERS_AT);
  const confidence = Math.round(agreeing.reduce((s, v) => s + v.confidence, 0) / agreeing.length);
  const others = ranked.slice(1).map(([n]) => n);

  const exhausted = verdicts.length >= camerasAvailable;
  const nearest = verdicts[0];
  // A lone, non-confident dissent can be outvoted — by three facade-visible agreeing angles
  // that include the nearest camera. Anything more than that is a real disagreement.
  const dissentOutvoted =
    dissent.length === 1 && !isConfident(dissent[0]) && vouching.length >= 3 && nearest.storeys === winner && nearest.facadeVisible;
  // Any unresolved disagreement is worth another angle while there is one to take.
  if (dissent.length > 0 && !dissentOutvoted && !exhausted) {
    return { storeys: winner, confidence, clear: false, reason: "angles disagree — trying another", wantsMore: true };
  }
  const nearestVetoes =
    nearest.storeys !== null && nearest.facadeVisible && nearest.confidence >= NEAREST_CAMERA_VETO_AT && nearest.storeys !== winner;
  if (nearestVetoes) {
    return { storeys: winner, confidence, clear: false, reason: `nearest camera says ${nearest.storeys}, others ${winner}`, wantsMore: false };
  }
  if (dissent.length > 0 && !dissentOutvoted) {
    return { storeys: winner, confidence, clear: false, reason: `angles disagree (${[winner, ...others].join(" vs ")})`, wantsMore: false };
  }
  if (vouching.length >= 2) {
    const mean = Math.round(vouching.reduce((s, v) => s + v.confidence, 0) / vouching.length);
    if (mean >= AGREEMENT_MIN_MEAN && (confidentFor.length > 0 || vouching.length >= 3)) {
      return { storeys: winner, confidence: mean, clear: true, reason: `${vouching.length} angles agree${dissentOutvoted ? ", one outvoted" : ""}`, wantsMore: false };
    }
  }
  if (camerasAvailable === 1 && confidentFor.length > 0 && vouching[0].confidence >= LONE_CAMERA_CONFIDENT) {
    return { storeys: winner, confidence, clear: true, reason: "one camera only, but a clear view", wantsMore: false };
  }
  return {
    storeys: winner,
    confidence,
    clear: false,
    reason: exhausted
      ? others.length > 0
        ? `angles split (${[winner, ...others].join(" vs ")}), none corroborated`
        : agreeing.length === 1
          ? "one angle only, not confident enough on its own"
          : vouching.length < 2
            ? "agreeing angles, but the facade was not clearly in view"
            : "agreeing angles, not confident enough"
      : "not yet corroborated",
    wantsMore: !exhausted,
  };
}

/** The whole thing for one property: up to STOREYS_MAX_ANGLES cameras, nearest first, judged
 *  one at a time and TALLIED after each (see tallyVerdicts) — stopping as soon as the tally is
 *  clear or a hard conflict makes more angles pointless. `onImage` is called for every frame
 *  judged, with the attempt number, for callers that keep them. */
export async function estimateStoreys(
  input: { target: LatLng | null; parcel: LatLng[] | null; label: string },
  keys: { maps: string; anthropic: string },
  onImage?: (jpeg: Buffer, attempt: number) => void
): Promise<StoreyResult> {
  if (!input.target) return { status: "no_point" };
  const cameras = await findStreetCameras(input.target, input.parcel, keys.maps);
  if (cameras.length === 0) return { status: "no_street_view" };
  const judged: Judged[] = [];
  let tally: Tally | null = null;
  let nearest = cameras[0].distanceM;
  for (let i = 0; i < cameras.length; i++) {
    const cam = cameras[i];
    const jpeg = await streetViewImage(cam, keys.maps);
    onImage?.(jpeg, i + 1);
    judged.push(await judgeStoreys(jpeg.toString("base64"), input.label, keys.anthropic));
    nearest = Math.min(nearest, cam.distanceM);
    tally = tallyVerdicts(judged, cameras.length);
    if (tally.clear || !tally.wantsMore) break;
  }
  const t = tally!;
  // The verdict the sheet sees: the tally's count and combined confidence, the facade flag from
  // the angles that agreed, the notes from the most confident agreeing angle plus the reason.
  const agreeing = judged.filter((v) => v.storeys === t.storeys);
  const lead = (agreeing.length > 0 ? agreeing : judged).reduce((a, b) => (b.confidence > a.confidence ? b : a));
  return {
    status: "ok",
    verdict: {
      storeys: t.storeys,
      confidence: t.confidence,
      facadeVisible: agreeing.some((v) => v.facadeVisible),
      buildingType: lead.buildingType,
      notes: `${t.reason}${lead.notes ? ` — ${lead.notes}` : ""}`,
      clear: t.clear,
      cameraDistanceM: nearest,
      attempts: judged.length,
    },
  };
}
