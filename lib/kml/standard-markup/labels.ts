// Marker labelling, split out of render-image.ts so the client can import it. That file
// pulls in sharp, which a client component can't touch — and the client needs this to
// label a lot the operator adds by clicking the map, because the render request treats
// the client's `label` as authoritative.

/** Google Static Maps marker labels must be a single character — numbers 1-9, then
 *  letters, for the rare block with more than 9 neighbours. */
export function markerLabel(index: number): string {
  return index < 9 ? String(index + 1) : String.fromCharCode(65 + (index - 9));
}
