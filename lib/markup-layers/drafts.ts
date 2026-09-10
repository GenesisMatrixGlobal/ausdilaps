// State transitions for the sheet, shared by every tool that hosts it. Pure functions over the
// previous value, so each tool's setState call is one line and the rules live in one place.

import type { LineItemDraft, LineItemDrafts } from "./line-items";

/** One cell edited. Changing the product clears any asset-type override on that row: the
 *  override was made against the OLD product, and keeping it silently is how a line ends up
 *  saying it's a Standard Internal inspection of an external GPS survey. */
export function applyCell(
  drafts: LineItemDrafts,
  key: string,
  field: keyof LineItemDraft,
  value: string
): LineItemDrafts {
  const row: Partial<LineItemDraft> = { ...drafts[key], [field]: value };
  if (field === "product") delete row.assetType;
  return { ...drafts, [key]: row };
}

/** Flip one row's tick. */
export function toggleDeselected(deselected: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(deselected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
