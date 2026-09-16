// The Closeout Markup's own vocabulary.
//
// Kept apart from the SOQL and the cadastre so the grouping rules — which are the whole of
// this tool's judgement — stay pure and testable (scripts/check-closeout.ts, no env, no
// network).

import type { LatLng } from "@/lib/kml/types";
import type { AuStateCode } from "@/lib/property-sizing/types";
import type { Precision } from "./group";

/**
 * How a property's inspections went.
 *
 * Four, not three. A building is routinely PART done — 803-815 King Georges Road was 8
 * completed and 19 access-failed on one outline — and collapsing that into any of the other
 * three either flatters the job or condemns it.
 *
 * `partial` is not a fifth colour: it is drawn as a GREEN OUTLINE with an ORANGE FILL (see
 * MARKUP_STYLES), which says "part done, work left" without putting another colour on a
 * drawing a client sees.
 */
export type InspectionColor = "green" | "red" | "orange" | "partial";

export const INSPECTION_LEGEND = {
  green: "Inspected",
  red: "Not inspected",
  orange: "Pending",
  partial: "Partially inspected",
} as const;

/** One work order, as this tool needs it. A subset of what the SOQL selects. */
export interface WorkOrderRow {
  id: string;
  number: string | null;
  status: string | null;
  statusCategory: string | null;
  stage: string | null;
  /** WorkType.Name. What decides whether this is an inspection at all — see
   *  NON_INSPECTION_WORK_TYPES. */
  workType: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  geocodeAccuracy: string | null;
  /** Site_Mark_Ups__c — a Box link to the markup drawn for this work order, when there is one. */
  siteMarkupUrl?: string | null;
  /** Cover_Photo_URL__c off the work order's Survey, when there is one. */
  coverPhotoUrl?: string | null;
}

/** A work order that was never an inspection — see NON_INSPECTION_WORK_TYPES. Counted and
 *  reported separately from `UnmappedWorkOrder`, because this is not a failure to place
 *  something: there was nothing at a place to begin with. */
export interface SkippedWorkOrder {
  id: string;
  number: string | null;
  street: string | null;
  workType: string | null;
}

/**
 * A council / external asset — a stretch of kerb, footpath, verge or roadway.
 *
 * Kept OUT of the properties and listed on its own, because it is not a property and has no
 * boundary this tool can look up. Its address geocodes to whatever private lot happens to be
 * beside it, so drawing that lot would colour someone's house as a council asset.
 *
 * Instead the operator draws the extent by hand from the reference images below — which is what
 * they are for. See docs in group.ts.
 */
export interface CouncilAsset {
  workOrderId: string;
  number: string | null;
  street: string;
  suburb: string | null;
  workType: string | null;
  color: InspectionColor;
  /** The report cover for this work order's survey, and the site markup filed against the work
   *  order itself. Either may be absent; both are Box links the operator opens in a new tab. */
  coverPhotoUrl: string | null;
  siteMarkupUrl: string | null;
}

/** A work order that IS an inspection but cannot go on a map, and why. Shown, never silently
 *  dropped: a closeout drawing that quietly omits properties under-reports the job, which is
 *  the one failure this tool must not have. */
export interface UnmappedWorkOrder {
  id: string;
  number: string | null;
  street: string | null;
  reason: string;
  /** Same reference a council asset gets. An inspection the tool could not place still has to
   *  go on the drawing by hand, and the operator needs something to place it FROM. */
  coverPhotoUrl: string | null;
  siteMarkupUrl: string | null;
}

/** One physical property — every work order that shares its location, collapsed. */
export interface CloseoutProperty {
  /** The rounded coordinate the group was formed on. Stable, so a re-resolve keeps row
   *  identity and the operator's tick state survives. */
  key: string;
  street: string;
  suburb: string | null;
  postcode: string | null;
  /** Null when neither the state field nor the postcode gave one — the cadastre is then
   *  skipped and the property is drawn as a pin. */
  state: AuStateCode | null;
  point: LatLng;
  color: InspectionColor;
  counts: Record<"green" | "red" | "orange", number>;
  workOrders: number;
  /** Work order numbers at this property, in the order Salesforce returned them. For the CSV
   *  — an operator chasing a red property needs the record, not just the address. */
  numbers: string[];
  /**
   * How well Salesforce located this, and therefore whether a cadastre parcel may be looked up
   * at all — see Precision in group.ts.
   *
   * There is no separate `coarse` boolean: it is exactly `precision !== "precise"`, and two
   * fields carrying one fact is two fields that can disagree.
   */
  precision: Precision;
  /** Another address sits on this exact coordinate. The statuses are still this property's, but
   *  the location is not exclusively its own — so it gets a pin rather than a parcel, and the
   *  sheet says so. Eight High Street terraces at Barangaroo share one geocode. */
  sharedPoint: boolean;
  accuracy: string | null;
}

export interface CloseoutOpportunity {
  id: string;
  name: string;
  stageName: string | null;
  accountName: string | null;
  boxFolderUrl: string | null;
  /** What Closeout_Markup__c holds today, so the panel can say a drawing is already filed
   *  rather than silently replacing one. */
  existingMarkupUrl: string | null;
  url: string | null;
}
