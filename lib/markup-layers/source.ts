// What a Quote Line Item sheet row is made FROM, independent of which tool produced it.
//
// The sheet started life under the Building Markup image, reading MarkupLayer directly — a
// geometry-heavy type (points, colour, line/area mode) that Bulk Property Sizing has no
// business producing. This is the seam between the two: a tool turns whatever it has into
// LineItemSource[] (see ./sources/*), and everything downstream — defaultDraft, rowsFrom,
// the shared table, the Salesforce payload — knows only this type. Change the sheet once,
// and both tools change.
//
// `detail` carries the tool's own record so the tool's leading columns (the markup's swatch
// and measurement; sizing's lot size, levels and dwelling area) can render from it. It is a
// discriminated union rather than `unknown` so a renderer can narrow without casting, and
// the shared code never reads it.

import type { MarkupLayer } from "./types";
import type { SizingResult } from "@/lib/property-sizing/types";

export type LineItemSourceDetail =
  | { kind: "markup"; layer: MarkupLayer }
  | { kind: "sizing"; result: SizingResult };

export interface LineItemSource {
  /** Stable join key: drafts and the tick state are keyed by it, and a markup's map bubbles
   *  look their number up by it. Markup rows use SUBJECT_KEY / lotKey / shapeKey (plan.ts). */
  key: string;
  /** What KIND of thing this is — "Site", "Lot", "Shape", "Property". Carries NO number: the
   *  quote item number is derived from the tick state in rowsFrom(). */
  label: string;
  street: string | null;
  suburb: string | null;
  lotPlan: string | null;
  /** One line of what was measured, for a sub-line under the row label. */
  measured: string;
  /** Hex without '#', for the colour swatch; null when the source has no colour. */
  swatch: string | null;
  /** What the row's cells start on. Already strings, the way the sheet holds them. */
  seed: {
    product: string;
    street: string;
    internalMetres: string;
    externalMetres: string;
    /** Storeys, as a string cell. Sizing seeds its estimate; a markup has nothing to offer. */
    levels: string;
  };
  /** False for something the operator removed from the job upstream (an unticked lot). Excluded
   *  sources are dropped from the sheet, not greyed. */
  included: boolean;
  /** Whether the row should arrive ticked. The tool seeds its `deselected` set from this when
   *  the sources first appear — rowsFrom() itself reads only `deselected`, so it stays a pure
   *  function of (sources, drafts, deselected). */
  startSelected: boolean;
  detail: LineItemSourceDetail;
}
