// Property sizing tool — shared types.
// Staff-only estimator utility: address list -> land/lot size (+ future building attrs).

export type AuStateCode = "QLD" | "NSW" | "VIC" | "SA" | "WA" | "TAS" | "ACT" | "NT";

/** A single address ready to be looked up. */
export interface ParsedAddress {
  /** Original ref/ID from the source list (e.g. the screenshot's left column), if any. */
  id?: string;
  /** The full address text as written. */
  raw: string;
  /** Unit/strata number if the address is a unit. */
  unit?: string;
  /** Street number + name only, e.g. "8 Ironwood Ct". */
  street: string;
  /** Suburb / locality only, e.g. "Mountain Creek". */
  suburb: string;
  state?: AuStateCode;
  postcode?: string;
}

export type LookupStatus =
  | "ok"
  | "no_parcel" // geocoded, but no titled parcel at that point (e.g. road/bridge)
  | "not_found" // address couldn't be geocoded
  | "unsupported_state" // state has no automated source wired yet
  | "number_mismatch" // geocoder resolved a DIFFERENT house number — the parcel is probably a neighbour's
  | "error";

/** One row of tool output. Columns mirror the estimator's target spreadsheet. */
export interface SizingResult {
  id?: string;
  raw: string;
  street: string;
  suburb: string;
  state?: AuStateCode;
  postcode?: string;

  // ── Land (live) ──
  lotSizeSqm: number | null;
  lotPlan: string | null;
  matchedAddress: string | null;
  matchScore: number | null;
  source: string | null;

  // ── Building attributes (schema present; pipeline lands in a later phase) ──
  levels: number | null;
  levelsConfidence: number | null; // 0–100
  dwellingAreaSqm: number | null;
  dwellingAreaConfidence: number | null; // 0–100

  status: LookupStatus;
  /** Human-readable notes: strata/shared-parcel, verify manually, etc. */
  flags: string[];
}

/** Internal lot-lookup output — a partial result plus the geocoded point and
 *  parcel geometry the building-attributes step needs. The underscore-prefixed
 *  fields are stripped before the result is returned to the client. */
export type LotResult = Partial<SizingResult> & {
  _lon?: number;
  _lat?: number;
  _parcelRings?: number[][][];
};
