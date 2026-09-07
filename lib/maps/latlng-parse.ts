// Coordinate validators shared by the tools' .json save formats.
//
// One copy, because both formats read files off an operator's disk and both have to reject
// the same things — a NaN or an out-of-range coordinate reaches Google's overlay as a shape
// that silently fails to render, which is the worst possible failure for a measuring tool.
// Two copies of these rules would drift.

import type { LatLng } from "@/lib/kml/types";

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function parseLatLng(raw: unknown): LatLng | null {
  if (!raw || typeof raw !== "object") return null;
  const { lat, lng } = raw as Record<string, unknown>;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Null when the input isn't an array or ANY point is bad — a ring with one broken vertex
 *  is not a ring, and half-loading it would draw the wrong shape. */
export function parseLatLngList(raw: unknown, maxPoints: number): LatLng[] | null {
  if (!Array.isArray(raw)) return null;
  const points: LatLng[] = [];
  for (const entry of raw.slice(0, maxPoints)) {
    const point = parseLatLng(entry);
    if (!point) return null;
    points.push(point);
  }
  return points;
}
