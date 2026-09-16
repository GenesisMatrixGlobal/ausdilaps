/**
 * How many properties one closeout drawing shows.
 *
 * A hard cap, and the tool refuses rather than truncating: the first 60 of 698 in street order
 * is a drawing of one suburb presented as a drawing of the job. Most jobs are nowhere near it —
 * 257 work orders at King Georges Road are 39 properties, 125 at Barangaroo are 95 — because
 * work orders are raised per unit and units collapse into buildings.
 *
 * Above the cap the sheet still works in full and still exports: reading a big job is useful
 * even when drawing one is not.
 */
export const MAX_CLOSEOUT_LOTS = 60;
