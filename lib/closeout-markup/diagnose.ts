// Why this opportunity cannot be drawn.
//
// ⚠️ The tool used to say NOTHING here. The whole toolbar, sheet and map are behind
// `properties.length > 0`, so an opportunity that produced no properties showed its name, a work
// order count, and then blank page — no button, no reason, nothing to act on (Rhys, 2026-09-18:
// "if it can't generate a markup, can it explain... and be specific to the work order or the
// opportunity").
//
// Every one of these outcomes is a NORMAL thing for a real job to be, and each has a different
// answer. What they have in common is that the fix is in Salesforce, on records this module can
// name — so it names them, by work order number, with the reason each one was set aside.
//
// Pure: no env, no network. Held to the real fixture by npm run check:closeout.

import type { CouncilAsset, SkippedWorkOrder, UnmappedWorkOrder } from "./types";

/** One work order behind the blocker, ready for the UI to list and link. */
export interface BlockerItem {
  /** The Salesforce record, so the UI can link straight to it. */
  id: string;
  number: string | null;
  /** What this work order is, or why it was set aside. */
  reason: string;
  street: string | null;
}

export interface CloseoutBlocker {
  /** One sentence: what is wrong. */
  headline: string;
  /** What to do about it — always an action, never a restatement. */
  next: string;
  items: BlockerItem[];
  /** More items than are worth listing; the UI folds the rest away. */
  total: number;
}

/** Long jobs: enough to recognise the pattern without turning the page into a list. */
const MAX_LISTED = 12;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The single most useful thing to say next, chosen by which bucket is biggest.
 *
 * Each of these is a different job for a different person: a work type is an admin fix, a missing
 * geocode is a data fix, a non-address Street is a typo or a genuine non-property, and a council
 * asset is simply the operator's to draw.
 */
function nextStep(skipped: number, unmapped: number, council: number, reasons: Set<string>): string {
  const biggest = Math.max(skipped, unmapped, council);

  if (biggest === council && council > 0) {
    // ⚠️ Deliberately does NOT say "draw them on the map". With no placeable property there is no
    // map: Generate needs at least one ticked property to have something to frame on. Promising a
    // blank markup that cannot be opened would be worse than saying nothing.
    return "An external GPS or council asset has no title boundary to look up, so it is always drawn by hand from its reference image — each is linked below. Note that the drawing itself needs at least one placeable property before a map will open.";
  }
  if (biggest === skipped && skipped > 0) {
    return "Billing and admin work orders are not inspections, so there is nothing to place. If one of these should have been an inspection, fix its Work Type in Salesforce and press Find again.";
  }
  if (reasons.size === 1 && reasons.has("No location on the work order")) {
    return "Salesforce has not geocoded these addresses. Check Street, City, State and Postcode on the work orders — the drawing uses Salesforce's own coordinates, so once it geocodes them press Find again.";
  }
  if (reasons.size === 1 && reasons.has("Not a street address")) {
    return "Their Street field does not hold an address, so there is no property to draw. Fix the Street in Salesforce if it should be one, or draw these by hand.";
  }
  return "Each work order above says why it could not be placed. Fix the ones that are data problems in Salesforce and press Find again; draw the rest by hand.";
}

/**
 * Why nothing can be drawn — or null when something can.
 *
 * `workOrderCount` is INSPECTIONS (it already excludes `skipped`), which is why the no-work-orders
 * test below has to look at both.
 */
export function diagnoseCloseout(input: {
  opportunityName: string;
  workOrderCount: number;
  propertyCount: number;
  skipped: SkippedWorkOrder[];
  unmapped: UnmappedWorkOrder[];
  councilAssets: CouncilAsset[];
}): CloseoutBlocker | null {
  if (input.propertyCount > 0) return null;

  const { skipped, unmapped, councilAssets } = input;

  // Nothing came back from Salesforce at all. The likeliest cause by a distance is the wrong
  // record: this org runs a PRE and a POST opportunity per job and the work orders hang off one
  // of them, so the drawing is empty on the twin rather than broken.
  if (input.workOrderCount === 0 && skipped.length === 0) {
    return {
      headline: `${input.opportunityName} has no work orders, so there is nothing to draw.`,
      next:
        "An overview markup is built from the work orders linked to the opportunity. Check this is the right record — a job's PRE and POST opportunities are separate, and the work orders sit on one of them.",
      items: [],
      total: 0,
    };
  }

  const parts: string[] = [];
  if (skipped.length > 0) parts.push(`${plural(skipped.length, "billing or admin work order")}`);
  if (councilAssets.length > 0) parts.push(`${plural(councilAssets.length, "external GPS or council asset")}`);
  if (unmapped.length > 0) parts.push(`${plural(unmapped.length, "inspection")} that couldn't be placed`);

  const items: BlockerItem[] = [
    ...skipped.map((s) => ({
      id: s.id,
      number: s.number,
      // The work type IS the reason here — "Billing Item" is why it was set aside.
      reason: s.workType ? `${s.workType} — not an inspection` : "No work type — not an inspection",
      street: s.street,
    })),
    ...councilAssets.map((c) => ({
      id: c.workOrderId,
      number: c.number,
      reason: `${c.workType ?? "External asset"} — no boundary to look up`,
      street: c.street,
    })),
    ...unmapped.map((u) => ({ id: u.id, number: u.number, reason: u.reason, street: u.street })),
  ];

  const reasons = new Set(unmapped.map((u) => u.reason));
  return {
    headline:
      parts.length === 1
        ? `Every work order on this opportunity is ${parts[0]} — there is no property to draw.`
        : `Nothing on this opportunity can be drawn: ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}.`,
    next: nextStep(skipped.length, unmapped.length, councilAssets.length, reasons),
    items: items.slice(0, MAX_LISTED),
    total: items.length,
  };
}

/**
 * Why the Generate button is off, when there ARE properties.
 *
 * A disabled button with no reason reads as a broken tool. Both of these are the operator's own
 * tick state, so both are one action away from fixed.
 */
export function generateBlockedReason(selected: number, total: number, max: number): string | null {
  if (selected === 0) {
    return total === 1
      ? "Tick the property in the sheet below to put it on the drawing."
      : `Nothing is ticked — tick at least one of the ${total} properties in the sheet below.`;
  }
  if (selected > max) {
    return `${selected} properties are ticked and one drawing holds ${max}. Untick ${selected - max}, or use Export CSV for the whole list.`;
  }
  return null;
}
