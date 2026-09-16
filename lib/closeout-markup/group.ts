// Work orders → properties, and properties → colours.
//
// Pure: no network, no env, no Salesforce types. `npm run check:closeout` drives it against
// fixtures taken from a real job, because every rule here was derived from what the org
// actually contains rather than from what a work order ought to look like.

import type { LatLng } from "@/lib/kml/types";
import { normalizeState, stateFromPostcode, STREET_TYPES } from "@/lib/property-sizing/parse";
import type { AuStateCode } from "@/lib/property-sizing/types";
import type {
  CloseoutProperty,
  InspectionColor,
  SkippedWorkOrder,
  UnmappedWorkOrder,
  WorkOrderRow,
} from "./types";

/**
 * Work types that are not an inspection of anything.
 *
 * ⚠️ Matched on WorkType.Name, not on the address text. `Access Letters` and `Induction` both
 * arrive as `Billing Item` — 422 of the 422 "Access Letters" work orders in the org are that
 * type — so the work type is the fact and the address string is a symptom. Text matching would
 * also have missed `9 Derwent Street (Basement), Billing Item`, which reads as a real address
 * and was inflating that building's inspection count by one.
 *
 * Deliberately short. `Engineer Review`, `Video - Processing`, `Site Recon` and `Resolutions`
 * are office work too, but each can legitimately hang off a property that WAS inspected, and
 * dropping a real inspection is a worse error than counting an extra desk job.
 */
const NON_INSPECTION_WORK_TYPES = new Set(["Billing Item", "Training", "Training (Auto)"]);

export function isInspection(row: Pick<WorkOrderRow, "workType">): boolean {
  return !NON_INSPECTION_WORK_TYPES.has(row.workType ?? "");
}

/**
 * Where a work order sits on the green / red / orange scale.
 *
 * Keyed on StatusCategory, NOT Status. The Status picklist has accumulated values over 15
 * years and live records still carry inactive ones — `Schedule` and `Scheduled` both exist,
 * as do `Cannot Complete` and `Access Failed` — so a list of status strings would be a list
 * that goes stale the next time someone edits the picklist. StatusCategory is the standard
 * field behind it and has seven fixed values.
 */
export function colorForWorkOrder(row: Pick<WorkOrderRow, "statusCategory">): "green" | "red" | "orange" {
  switch (row.statusCategory) {
    case "Completed":
      // Covers `Completed` and `Partially Complete` — both categorise as Completed in the org.
      return "green";
    case "CannotComplete":
    case "Canceled":
      // `Access Failed` is the overwhelming case: the job closed without getting inside.
      return "red";
    default:
      // New / InProgress / OnHold / None / null — still to happen.
      return "orange";
  }
}

/**
 * The property's colour from its work orders'.
 *
 * One distinct colour → that colour. More than one → `partial`, drawn as a green outline with
 * an orange fill. Deliberately not a majority or an "any completed counts" rule: on a closeout
 * drawing the question is "is there anything left here?", and 8 done out of 27 is not an
 * inspected building.
 */
export function colorForProperty(counts: Record<"green" | "red" | "orange", number>): InspectionColor {
  const present = (["green", "red", "orange"] as const).filter((c) => counts[c] > 0);
  if (present.length === 0) return "orange";
  return present.length === 1 ? present[0] : "partial";
}

/**
 * How much the work order's coordinate can be trusted.
 *
 * `precise` — a building. A parcel may be looked up under it.
 * `approximate` — the right block or street. Drawn as a pin; a parcel under a block-level
 *   point is as likely to be the neighbour's, which is the failure houseNumberMismatch exists
 *   to catch in Bulk Property Sizing.
 * `area` — a suburb or postcode centroid. Still drawn, because losing it loses a real
 *   property from the closeout, but never given a parcel and always flagged.
 */
export type Precision = "precise" | "approximate" | "area";

const PRECISE_ACCURACY = new Set(["Address", "NearAddress", "Rooftop", "Range"]);
const AREA_ACCURACY = new Set(["City", "Zip", "Neighborhood", "PostalCode"]);

export function precisionOf(accuracy: string | null | undefined): Precision {
  if (PRECISE_ACCURACY.has(accuracy ?? "")) return "precise";
  if (AREA_ACCURACY.has(accuracy ?? "")) return "area";
  return "approximate";
}

/** ~1 m. Salesforce geocodes every unit of a building to a byte-identical pair, so this is an
 *  exact-match key in practice; the rounding only guards against float formatting. */
function locationKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

/** Metres between two points, near enough — a local flat-earth approximation is fine at the
 *  tens-of-metres scale this is used at. */
function metresBetween(a: LatLng, b: LatLng): number {
  const latM = (a.lat - b.lat) * 111_320;
  const lngM = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(latM, lngM);
}

/**
 * Splitting a work order's `Street` into the tenancy and the property.
 *
 * ⚠️ The shape of this field is `<tenancy>, <address>`, and the tenancy is NOT always a unit
 * number. On one job it arrives as `101 , 9 Derwent Street`, `G01 , 9 Derwent Street`,
 * `Commercial 1, 4-8 Allen Street`, `McDonald's, 799 King Georges Road` and `Gavan Property -
 * GL Shop 1, 803-815 King Georges Road` — all at the same handful of buildings. A prefix
 * regex was tried first and could not cover that; splitting on the comma and asking which
 * SEGMENT is the address does, because the address is always last.
 */
function addressSegment(raw: string): string {
  const segments = raw
    .split(",")
    .map((x) => x.replace(/\s+/g, " ").trim().replace(FLOOR_PREFIX, "").trim())
    .filter(Boolean);
  if (segments.length === 0) return "";
  if (segments.length === 1) return segments[0];

  const startsWithNumber = (x: string) => /^\d+[a-z]?\b/i.test(x);
  const hasStreetType = (x: string) =>
    x.split(/[\s/]+/).some((w) => STREET_TYPES.has(w.replace(/[^a-z]/gi, "").toUpperCase()));

  // Best: a segment that opens with a house number AND names a street type. That is the one
  // case where we are sure which part is the property — `9 Derwent Street / Suite 1, 51
  // Connells Point` has to resolve to Derwent Street, and the LAST-numbered-segment rule alone
  // would pick the cross street.
  const full = segments.filter((x) => startsWithNumber(x) && hasStreetType(x));
  if (full.length) return full[full.length - 1];

  // Then: the last segment opening with a house number — covers `Commercial 1, 4-8 Allen St`
  // when the type word is one we deliberately don't recognise.
  const numbered = segments.filter(startsWithNumber);
  if (numbered.length) return numbered[numbered.length - 1];

  // Nothing looks like an address. Hand back the whole thing and let looksLikeAddress decide.
  return segments.join(", ");
}

/** A tenancy written as a prefix with no comma — `Ground Floor 803-815 King Georges Road`. */
const FLOOR_PREFIX = /^\s*(?:ground\s+floor|lower\s+ground(?:\s+floor)?|basement|level\s+\d+|floor\s+\d+)\s+/i;
/** `Lloyd's IGA - 59 Connells Point Road`: a business name, a dash, then the real address.
 *  Only stripped when a NUMBER follows the dash, so `59 Bells Line of Road` keeps its name. */
const BUSINESS_PREFIX = /^.{2,60}?\s+-\s+(?=\d)/;

/**
 * The street as it should read on the drawing.
 *
 * Work orders are raised PER UNIT, so one building arrives as dozens of `Street` values that
 * differ only in their tenancy. Reducing them to one address is what turns 73 work orders into
 * one property, and it is the difference between a drawing and a list.
 */
export function cleanStreet(raw: string | null | undefined): string {
  const flat = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  let s = addressSegment(flat);
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(BUSINESS_PREFIX, "").replace(FLOOR_PREFIX, "").trim();
    if (s === before) break;
  }
  // A trailing parenthetical is a note about the tenancy, never part of the address:
  // `9 Derwent Street (Basement)`.
  s = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
  // ⚠️ A slash means a unit, and the address can be on EITHER side of it:
  //   `1/48-50 Connells Point Road`   — unit first, address after
  //   `9 Derwent Street / Suite 1`    — address first, tenancy after
  // The side naming a street TYPE is the address. Picking a side by position alone reduced
  // three tenancies of 48-50 Connells Point Road to the streets "1", "2" and "3", which then
  // looked like three different addresses and lost the building.
  const slash = s.indexOf("/");
  if (slash >= 0) {
    const before = s.slice(0, slash).trim();
    const after = s.slice(slash + 1).trim();
    const isAddress = (x: string) =>
      /^\d+[a-z]?\b/i.test(x) &&
      x.split(/\s+/).some((w) => STREET_TYPES.has(w.replace(/[^a-z]/gi, "").toUpperCase()));
    if (isAddress(after) && !isAddress(before)) s = after;
    else if (isAddress(before)) s = before;
  }
  // `824 -828` is a typo for `824-828` and nothing else; leaving it in makes one building read
  // as two addresses.
  s = s.replace(/(\d)\s*-\s*(\d)/g, "$1-$2").trim();
  return s || flat;
}

/**
 * A comparison key for "are these the same address?".
 *
 * Needed because work orders at ONE building carry the same address with different debris
 * hung off it — `9 Derwent Street (Basement), Billing Item` and `9 Derwent Street / Suite 1,
 * 51 Connells Point` are the same building. Comparing the cleaned strings marked 174 of 257
 * work orders as "several addresses share this location" and took most of the job off the
 * drawing.
 *
 * So: cut at the first bracket, slash or comma — everything after one is a tenancy, a billing
 * note or a cross-street — then flatten case, punctuation and spacing around number ranges,
 * so `824 -828` and `824-828` agree.
 */
export function addressCore(street: string): string {
  return street
    .toLowerCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/[^a-z0-9\- ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does this read like a street address at all?
 *
 * Work orders get raised for things that are not properties — `Induction` is a real one on the
 * job this was built against, four of them, all geocoded to the middle of Sydney. Without this
 * they become a property on the drawing, in the CBD, 15 km from the job.
 *
 * A digit is the test rather than a leading house number, because `Unit 5 King Georges Road`
 * is a real address and `Corner of X and Y` is not. It errs toward keeping data.
 */
export function looksLikeAddress(street: string): boolean {
  return /\d/.test(street);
}

/**
 * The address to print, chosen in two steps.
 *
 * The most common CORE wins the group, then the shortest cleaned variant carrying that core
 * wins the label — so a building whose work orders say `9 Derwent Street`, `9 Derwent Street
 * (Basement), Billing Item` and `9 Derwent Street / Suite 1, 51 Connells Point` is printed as
 * `9 Derwent Street`. Shortest, because the plainest form of an address is the one with no
 * tenancy hung off it; alphabetical last, only so the same input always gives the same drawing.
 */
function pickStreet(rows: WorkOrderRow[]): string {
  const cleaned = rows.map((r) => cleanStreet(r.street)).filter(Boolean);
  if (cleaned.length === 0) return "";
  const byCore = new Map<string, number>();
  for (const c of cleaned) {
    const core = addressCore(c);
    if (core) byCore.set(core, (byCore.get(core) ?? 0) + 1);
  }
  if (byCore.size === 0) return cleaned[0];
  const winner = [...byCore.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  return cleaned
    .filter((c) => addressCore(c) === winner)
    .sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

/** The most common non-empty value of a field across the group. */
function pickField(rows: WorkOrderRow[], field: "city" | "postalCode"): string | null {
  const tally = new Map<string, number>();
  for (const r of rows) {
    const v = (r[field] ?? "").trim();
    if (v) tally.set(v, (tally.get(v) ?? 0) + 1);
  }
  if (tally.size === 0) return null;
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/** The state, from the work order's own field first (it is typed by a human and normalises
 *  `Victoria`), then from the postcode. Null for neither — the caller draws a pin. */
function pickState(rows: WorkOrderRow[], postcode: string | null): AuStateCode | null {
  for (const r of rows) {
    const s = normalizeState(r.state);
    if (s) return s;
  }
  return stateFromPostcode(postcode) ?? null;
}

export interface GroupResult {
  properties: CloseoutProperty[];
  unmapped: UnmappedWorkOrder[];
  /** Never inspections — billing lines, inductions, training. Not failures. */
  skipped: SkippedWorkOrder[];
}

/** Same street, same suburb, close together = the same building. Two work orders on one
 *  building can geocode a few metres apart ("Ground Floor 803-815 King Georges Road" landed
 *  9.6 m from "10, 803-815 King Georges Road"), which would otherwise draw the building twice
 *  with the statuses split between the two pins. The distance guard is what keeps a street
 *  with no house number from swallowing its own far end. */
const SAME_BUILDING_METRES = 150;

/**
 * Collapse an opportunity's work orders into the properties a drawing shows.
 *
 * Grouped on the COORDINATE, never on the address string. On the job this was written against
 * 257 work orders held 254 distinct `Street` values and 42 distinct coordinates: unit numbers,
 * tenancy names and stray spacing make string matching useless, while Salesforce geocodes
 * every unit of a building to the same point.
 */
export function groupWorkOrders(rows: WorkOrderRow[]): GroupResult {
  const unmapped: UnmappedWorkOrder[] = [];
  const skipped: SkippedWorkOrder[] = [];
  const groups = new Map<string, WorkOrderRow[]>();

  for (const row of rows) {
    // Before anything else: a billing line or an induction was never an inspection, so it must
    // not reach a property's counts, its colour, or the "couldn't be placed" list.
    if (!isInspection(row)) {
      skipped.push({ id: row.id, number: row.number, street: row.street, workType: row.workType });
      continue;
    }
    if (row.latitude == null || row.longitude == null) {
      unmapped.push({ id: row.id, number: row.number, street: row.street, reason: "No location on the work order" });
      continue;
    }
    const key = locationKey(row.latitude, row.longitude);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const properties: CloseoutProperty[] = [];
  for (const [key, group] of groups) {
    // ⚠️ Work orders at one coordinate are sub-grouped BY ADDRESS, not assumed to be one
    // property. Both things happen in the org and they need opposite handling:
    //
    //   - 75 work orders at 9 Derwent Street are 75 units of one building → one property.
    //   - 74, 76, 78, 80, 74A, 76A, 78A and 80A High Street all geocoded to one point at
    //     Barangaroo → eight real terraces. An earlier rule kept the majority address and
    //     discarded the rest, which took 114 of that job's 125 work orders off the drawing.
    //
    // Splitting by address answers both. What a shared point genuinely costs is the BOUNDARY:
    // a cadastre lookup under it would hand all eight the same parcel, so they are pinned.
    const byCore = new Map<string, WorkOrderRow[]>();
    for (const r of group) {
      const core = addressCore(cleanStreet(r.street));
      const list = byCore.get(core);
      if (list) list.push(r);
      else byCore.set(core, [r]);
    }

    const placeable = [...byCore.values()].filter((rows) => {
      const street = pickStreet(rows);
      return Boolean(street) && looksLikeAddress(street);
    });

    for (const rows of byCore.values()) {
      const street = pickStreet(rows);
      if (!street || !looksLikeAddress(street)) {
        // A work order raised against something that is not a property: `Induction`,
        // `Access Letters`, `Wulugul Walk`, `Hickson Road Staircase`. Real work, not a place
        // this drawing can show — listed rather than silently dropped.
        for (const r of rows) {
          unmapped.push({ id: r.id, number: r.number, street: r.street, reason: "Not a street address" });
        }
        continue;
      }

      const sharedPoint = placeable.length > 1;
      const counts = { green: 0, red: 0, orange: 0 };
      for (const r of rows) counts[colorForWorkOrder(r)]++;

      const rawPrecision = precisionOf(
        rows.find((r) => precisionOf(r.geocodeAccuracy) === "precise")?.geocodeAccuracy ??
          rows[0].geocodeAccuracy
      );
      // Sharing a point caps the precision: whatever Salesforce called the geocode, it cannot
      // be telling us where THIS address's boundary is if it says the same for seven others.
      const precision: Precision =
        sharedPoint && rawPrecision === "precise" ? "approximate" : rawPrecision;

      const postcode = pickField(rows, "postalCode");
      properties.push({
        // The sub-group's own key, so two addresses at one coordinate stay distinct rows and
        // the operator's tick state survives a re-resolve.
        key: placeable.length > 1 ? `${key}#${addressCore(street)}` : key,
        street,
        suburb: pickField(rows, "city"),
        postcode,
        state: pickState(rows, postcode),
        // The group's own point, not an average: every member carries the same pair, and
        // averaging would invent a coordinate that no work order actually has.
        point: { lat: rows[0].latitude!, lng: rows[0].longitude! },
        color: colorForProperty(counts),
        counts,
        workOrders: rows.length,
        numbers: rows.map((r) => r.number).filter((n): n is string => Boolean(n)),
        precision,
        sharedPoint,
        accuracy: rows[0].geocodeAccuracy ?? null,
      });
    }
  }

  const merged = mergeSameBuilding(properties);

  // Street order, so the sheet reads like a walk down the job rather than like Salesforce's
  // record order. Numeric-aware, or "9 Derwent" sorts after "101 Derwent".
  merged.sort(
    (a, b) =>
      (a.suburb ?? "").localeCompare(b.suburb ?? "") ||
      a.street.localeCompare(b.street, undefined, { numeric: true, sensitivity: "base" })
  );
  return { properties: merged, unmapped, skipped };
}

/** Fold groups that are plainly the same building back together — see SAME_BUILDING_METRES. */
function mergeSameBuilding(properties: CloseoutProperty[]): CloseoutProperty[] {
  const out: CloseoutProperty[] = [];
  for (const p of properties) {
    const twin = out.find(
      (q) =>
        addressCore(q.street) === addressCore(p.street) &&
        (q.suburb ?? "") === (p.suburb ?? "") &&
        // Distance only decides between two points that both claim to BE somewhere. An
        // `area` geocode is a suburb centroid, so it is nowhere near the building by
        // construction — if a precise point elsewhere names the same address, that is the
        // same property and the kilometre between them says nothing.
        (q.precision === "area" ||
          p.precision === "area" ||
          metresBetween(q.point, p.point) <= SAME_BUILDING_METRES)
    );
    if (!twin) {
      out.push({ ...p, counts: { ...p.counts }, numbers: [...p.numbers] });
      continue;
    }
    twin.counts.green += p.counts.green;
    twin.counts.red += p.counts.red;
    twin.counts.orange += p.counts.orange;
    twin.workOrders += p.workOrders;
    twin.numbers.push(...p.numbers);
    twin.color = colorForProperty(twin.counts);
    // Keep the better geocode: the merged pin should sit on whichever point Salesforce was
    // most confident about, and a parcel may only be looked up under a precise one.
    if (twin.precision !== "precise" && p.precision === "precise") {
      twin.point = p.point;
      twin.key = p.key;
      twin.precision = p.precision;
      // ⚠️ And it is no longer sharing a point. A precise geocode is never capped to
      // "approximate" unless it was shared, so adopting one means this address has a location
      // of its own after all — leaving sharedPoint set would deny it a parcel it can have.
      twin.sharedPoint = false;
      twin.accuracy = p.accuracy;
    }
  }
  return out;
}
