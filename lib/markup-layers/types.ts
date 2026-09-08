// The layer model behind "each layer of a Building Markup becomes a Quote Line Item".
//
// A "layer" is one thing an estimator would price: the subject lot, a detected adjoining lot,
// or a hand-drawn shape. The markup tool already produces all three — what it has never had is
// any notion of what a layer IS.
//
// An earlier version of this file carried its own invented table of PHYSICAL asset types
// (kerb & channel, nature strip, footpath, culvert) each with a unit of each/m²/m. The org's
// real Asset Type picklist turned out to be INSPECTION types — Standard Internal, External
// GPS, Common Areas — with no unit axis at all, and it is derived from the chosen product, not
// from the drawing. That table and its unit system are gone; see ./salesforce-picklists.ts.
//
// What survives from the drawing is the one thing colour genuinely tells us: blue is internal,
// orange is external, which is the axis the sheet's two measurement columns split on.

import type { LatLng } from "@/lib/kml/types";
import type { ShapeMode } from "@/lib/kml/standard-markup/measure";
import type { ShapeColorKey } from "@/lib/kml/standard-markup/style";

export type LayerKind = "subject" | "lot" | "shape";

/**
 * One priceable thing on a markup, flattened out of the save file.
 *
 * Measurements are carried as raw numbers, not formatted strings: the line item needs a
 * quantity, and formatArea() is for humans. `areaSqm` is present for every layer type;
 * `lengthMetres` and `widthMetres` only for line-mode shapes.
 */
export interface MarkupLayer {
  /** Stable within a markup, and stable across a save/reopen — it is the join key that stops
   *  a re-sync duplicating line items. Lots use their cadastre id; shapes use their persisted
   *  id (see building-markup-file.ts v2). */
  key: string;
  kind: LayerKind;
  /** What KIND of thing this is: "Site", "Lot", "Shape". Deliberately carries no number — the
   *  quote item number lives on the sheet's row (see line-items.ts) and is derived from the tick
   *  state, so baking one in here would create a second, disagreeing series. */
  label: string;
  areaSqm: number | null;
  lengthMetres: number | null;
  widthMetres: number | null;
  /** Cadastre lot/plan — lots and the subject only. */
  lotPlan: string | null;
  /** From the state's address layer for a lot, or the typed address for the subject. Null for
   *  a shape, which has no parcel to look one up from. */
  street: string | null;
  suburb: string | null;
  /** Line-mode shapes only; null for lots and areas. */
  mode: ShapeMode | null;
  /** How the layer is drawn on the markup, so the sheet's row can carry the same swatch the
   *  operator is looking at on the image — and, more usefully, decide internal vs external.
   *  Subject is red and a detected lot is blue by construction; a shape carries its own. */
  color: ShapeColorKey;
  /** False for a lot the operator unticked, or the subject with hideSubject set. Excluded
   *  layers stay in the list so the UI can show them greyed rather than vanishing. */
  included: boolean;
  /** Kept so a caller can re-measure or re-draw without going back to the file. */
  points: LatLng[];
}
