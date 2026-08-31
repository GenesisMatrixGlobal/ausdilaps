// Identifies the subject parcel and its true (edge-adjacent) neighbours from the
// wider set of nearby parcels an envelope query returns (see ./parcels/*.ts).

import type { LatLng } from "@/lib/kml/types";
import { closeRing, minDistanceBetween, pointInRing } from "./geometry";
import type { ParcelFeature } from "./parcels/types";

/** True adjacent parcels usually share boundary vertices (~0m apart), but a rear
 *  neighbour can sit just across a narrow laneway/right-of-way — confirmed live at
 *  3.2m for a real Melbourne inner-suburb rear lot, with the next-closest non-touching
 *  candidate at 6.1m. 4m safely catches the former without reaching the latter; parcels
 *  across a proper street sit behind the road+footpath gap (typically >=10m). */
const ADJACENCY_TOLERANCE_M = 4;

export interface SubjectAndNeighbours {
  subject: ParcelFeature;
  neighbours: ParcelFeature[];
  flags: string[];
}

function centroidDistance(point: LatLng, ring: LatLng[]): number {
  const lat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
  const lng = ring.reduce((s, p) => s + p.lng, 0) / ring.length;
  return Math.hypot(point.lat - lat, point.lng - lng);
}

/** Every candidate within `toleranceM` of `subject`'s boundary — i.e. genuinely
 *  touching it, not merely nearby (across the street, same block). */
function filterTrueNeighbours(
  subject: ParcelFeature,
  candidates: ParcelFeature[],
  toleranceM = ADJACENCY_TOLERANCE_M
): ParcelFeature[] {
  const subjectRing = closeRing(subject.ring);
  return candidates.filter((c) => minDistanceBetween(subjectRing, closeRing(c.ring)) <= toleranceM);
}

/** Splits an envelope query's candidates into "the subject parcel" (containing the
 *  geocoded point) and its true neighbours. Returns null if there were no candidates at all. */
export function identifySubjectAndNeighbours(point: LatLng, candidates: ParcelFeature[]): SubjectAndNeighbours | null {
  // Titled lots only. An envelope query also returns road reserves and easements (see
  // ParcelKind), which are neither a plausible subject nor a neighbouring property — left
  // in, every job picked up numbered "lots" carrying no lot number and no area, spending
  // pin letters on the street out front.
  const lots = candidates.filter((f) => f.kind === "lot");
  if (lots.length === 0) return null;

  const flags: string[] = [];
  let subject = lots.find((f) => pointInRing(point, f.ring));
  if (!subject) {
    subject = lots.reduce((closest, f) =>
      centroidDistance(point, f.ring) < centroidDistance(point, closest.ring) ? f : closest
    );
    flags.push("subject parcel identified by nearest-centroid fallback — verify boundaries on site");
  }

  const neighbours = filterTrueNeighbours(
    subject,
    lots.filter((f) => f !== subject)
  );
  return { subject, neighbours, flags };
}
