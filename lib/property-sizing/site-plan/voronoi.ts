import type { Blob } from "./segment";

export interface LabelAnchor {
  code: string;
  x: number; // absolute pixel coords in the page image
  y: number;
}

/**
 * Buildings that physically touch (shared walls / breezeways) get rasterised as one
 * seamless colour region with no pixel-level boundary between codes. There's no way to
 * recover the true dividing line from pixels alone, so each pixel is assigned to its
 * nearest code label as a proportional estimate — good enough to flag for a human to
 * verify, not precise enough to trust blind.
 */
export function splitByNearestLabel(blob: Blob, anchors: LabelAnchor[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of anchors) counts.set(a.code, 0);
  if (anchors.length === 0) return counts;

  for (let i = 0; i < blob.pixelCount; i++) {
    const x = blob.xs[i];
    const y = blob.ys[i];
    let bestCode = anchors[0].code;
    let bestDist = Infinity;
    for (const a of anchors) {
      const dx = x - a.x;
      const dy = y - a.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        bestCode = a.code;
      }
    }
    counts.set(bestCode, (counts.get(bestCode) ?? 0) + 1);
  }

  return counts;
}
