// What a parcel's `idKey` is, and whether it can be shown as a lot/plan.
//
// The id is a per-state cadastral identifier — QLD `lotplan`, NSW `lotidstring`, VIC
// `parcel_spi` — and the tool prints it on the markup and on the Quote Line Item sheet as the
// lot/plan. Two kinds of id are NOT that, and printing them as one would put a made-up
// reference on a dilapidation report:
//
//   n<index>   a positional placeholder, assigned when the cadastre gave no identifier at all
//   prop:<pfi> a Vicmap PROPERTY id, from the fallback in ./vic.ts — a property PFI is an
//              internal key, not a title reference
//
// The rule lived inline as `id.startsWith("n") ? null : id` in two files that had to agree.
// It lives here now, so adding a third kind of id is one edit rather than a hunt.

/** Prefix for ids that came from Vicmap Property rather than a parcel cadastre. */
export const PROPERTY_ID_PREFIX = "prop:";

/** The cadastral lot/plan an id represents, or null when it isn't one. */
export function lotPlanFromId(id: string): string | null {
  if (!id) return null;
  if (id.startsWith(PROPERTY_ID_PREFIX)) return null;
  // Positional placeholder from resolve.ts / the providers. Safe as a prefix test because no
  // state's identifier starts with a lower-case n: QLD is "15RP815277", NSW "1//DP29132",
  // VIC "2/TP710607".
  if (id.startsWith("n")) return null;
  return id;
}

export function isPropertyFallbackId(id: string): boolean {
  return id.startsWith(PROPERTY_ID_PREFIX);
}
