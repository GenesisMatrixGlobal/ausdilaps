// The roadway-video rate card, and the only place the 5 km rule lives.
//
// Lifted verbatim from "2. Schedule Of Rates" in the estimation sheet template
// (OPT-XXXXX, Estimation Sheet 7.3.xlsx), items 1.09 and 1.10:
//
//   VU5  Roadways - video - per lane - up to 5km   Ea   pre $2,250   post $2,700
//   VO5  Roadways - video - per lane - above 5km   KM   pre $650     post $845
//
// NOTE the discontinuity this creates, and price accordingly on purpose: a 5.0 km road
// costs $2,250/lane, a 5.1 km road costs $3,315/lane. Read literally the card defines two
// bands, which is what priceSegment does. If the intent was instead "VU5 is a minimum
// charge" (i.e. max of the flat rate and the per-km rate), that is a one-line change here
// and nowhere else.

import type { Stage } from "./types";

export const RATES = {
  /** Flat per-lane charge for a segment of 5 km or less. */
  VU5: { pre: 2250, post: 2700 },
  /** Per-lane, per-km charge for a segment over 5 km. */
  VO5: { pre: 650, post: 845 },
} as const;

/** The band boundary, in km. At or below this it is VU5; above it, VO5. */
export const SHORT_SEGMENT_KM = 5;

/** Lane count used when OSM has nothing to say — a sealed rural road, one lane each way. */
export const DEFAULT_LANES = 2;

export type RateCode = "VU5" | "VO5";

export function rateCodeFor(lengthKm: number): RateCode {
  return lengthKm <= SHORT_SEGMENT_KM ? "VU5" : "VO5";
}

export function priceSegment(lengthKm: number, lanes: number, stage: Stage): number {
  const effectiveLanes = lanes > 0 ? lanes : DEFAULT_LANES;
  return rateCodeFor(lengthKm) === "VU5"
    ? RATES.VU5[stage] * effectiveLanes
    : RATES.VO5[stage] * lengthKm * effectiveLanes;
}

/** Lane-kilometres — the unit the fee actually scales on, and worth showing on its own. */
export function laneKm(lengthKm: number, lanes: number): number {
  return lengthKm * (lanes > 0 ? lanes : DEFAULT_LANES);
}
