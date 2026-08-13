// Identifies the subject parcel and its true (edge-adjacent) neighbours from the
// wider set of nearby parcels an envelope query returns (see ./parcels/*.ts).

import type { LatLng } from "@/lib/kml/types";
import { closeRing, minDistanceBetween, pointInRing } from "./geometry";
import type { ParcelFeature } from "./parcels/types";

/** True adjacent parcels share boundary vertices (~0m apart); parcels across the
 *  road sit behind the road+footpath gap (typically >=10m) — a fixed tolerance
 *  reliably tells them apart without having to model the road geometry at all. */
const ADJACENCY_TOLERANCE_M = 3;

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
export function filterTrueNeighbours(
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
  if (candidates.length === 0) return null;

  const flags: string[] = [];
  let subject = candidates.find((f) => pointInRing(point, f.ring));
  if (!subject) {
    subject = candidates.reduce((closest, f) =>
      centroidDistance(point, f.ring) < centroidDistance(point, closest.ring) ? f : closest
    );
    flags.push("subject parcel identified by nearest-centroid fallback — verify boundaries on site");
  }

  const neighbours = filterTrueNeighbours(
    subject,
    candidates.filter((f) => f !== subject)
  );
  return { subject, neighbours, flags };
}
