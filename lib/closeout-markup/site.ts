// The PROJECT SITE — the works the job is about — read off the Opportunity.
//
// Every other outline on a closeout comes from a work order, which Salesforce has already
// geocoded. This one does not: `Site_Address__c` is populated on 97% of opportunities and
// geocoded on 0% of them (measured over 2,000 records, 2026-09-18 — the org's clean rules run
// on WorkOrder.Address, not on this field). So this is the one part of the tool that spends a
// Google geocode, at one call per address segment.
//
// ⚠️ It is also free text, and only 72% of it is a single clean street address:
//
//   single         72%   "27 Fletcher Street"
//   no number      25%   "Western Tunneling Package", "Video Inspection"
//   two addresses   2%   "172-180 Anzac Parade & 116R Todman Avenue"
//   intersection    1%   "Corner Nissen Street & Urraween Road"
//
// A quarter of it is a project NAME typed into an address field. Those geocode happily to a
// suburb centroid, which is exactly the "convincing, completely wrong" outline this codebase
// keeps warning about — so the precision gate in google-geocode.ts is load-bearing here, and
// anything it rejects is REPORTED rather than drawn.

import { parcelAtPoint } from "@/lib/kml/standard-markup/parcel-at-point";
import type { LatLng } from "@/lib/kml/types";
import { geocodeViaGoogle } from "@/lib/property-sizing/google-geocode";
import type { AuStateCode } from "@/lib/property-sizing/types";
import { mapPool } from "@/lib/util/map-pool";
import { CADASTRE_STATES, parcelByAddress } from "./parcels";
import type { CloseoutSiteAddress, CloseoutSiteLot, ResolvedCloseoutSite } from "./types";
import type { StandardMarkupState } from "@/lib/kml/standard-markup/resolve";

/** One lot at a time is the common case; a handful is the worst. Same ceiling as the properties. */
const CONCURRENCY = 3;

/** Opens with a house number — "12", "1-5", "21C", "2/14". The same bar hasExactAddress() sets
 *  on a work order: without a number there is no parcel to find, only a street. */
const HOUSE_NUMBER_START = /^\d+[a-z]?\b/i;

/** A segment that is ONLY a number, so it must borrow the street name that follows it. */
const NUMBER_ONLY = /^\d+[a-z]?(\s*[-–]\s*\d+[a-z]?)?$/i;

/**
 * ⚠️ A ROOFTOP-grade geocode only, which is STRICTER than the shared precision gate.
 *
 * That gate lets a GEOMETRIC_CENTER through on its `types`, and every other caller can afford
 * it because the state ADDRESS LAYER checks the answer afterwards. This one cannot: a project
 * site's constituent addresses have usually been consolidated into one development lot and
 * deleted from the address layer — which is exactly why the layer misses them — so there is no
 * second opinion available and the geocode is the only thing standing between "the works" and
 * a confident red outline over a stranger's property.
 *
 * Measured on Rhys's own test job: "12 Sturt Street, Telopea" returns GEOMETRIC_CENTER with a
 * plus code in the formatted address, 389 m from the real site, sitting on an unrelated
 * 24,062 m² lot. The other two segments return ROOFTOP and land on the right one.
 */
const SITE_LOCATION_TYPES = new Set(["ROOFTOP", "RANGE_INTERPOLATED"]);

/**
 * Split a site address into the individual addresses it names.
 *
 * ⚠️ "1-5 Polding Place, 6 & 12 Sturt Street" is THREE addresses, and the second one is the
 * bare number "6" — it borrows its street from the segment after it. Rhys's own test job is
 * exactly this shape, and geocoding the whole string instead returns one precise-looking hit
 * for one of the three, which would draw a third of the site and look finished.
 *
 * Pure, so scripts/check-closeout.ts can hold it to the real strings out of the org.
 */
export function siteAddressSegments(street: string | null | undefined): string[] {
  const raw = (street ?? "").replace(/\s+/g, " ").trim().replace(/[,&]\s*$/, "");
  if (!raw) return [];

  const parts = raw
    .split(/\s*,\s*|\s+&\s+|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);

  // Right to left, so a bare number picks up the street of the segment that follows it.
  const out: string[] = [];
  let streetName: string | null = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (NUMBER_ONLY.test(part)) {
      if (streetName) out.unshift(`${part} ${streetName}`);
      // No street to borrow (a trailing "6" with nothing after it) — drop it. A number alone
      // geocodes to anything at all.
      continue;
    }
    const withoutNumber = part.replace(HOUSE_NUMBER_START, "").trim();
    if (withoutNumber) streetName = withoutNumber;
    out.unshift(part);
  }
  return out;
}

/** The single line handed to Google: the segment plus whatever locality the record carries. */
function addressLine(segment: string, site: CloseoutSiteAddress): string {
  return [segment, site.suburb, [site.state, site.postcode].filter(Boolean).join(" ")]
    .filter((p) => p && p.trim())
    .join(", ");
}

/**
 * Resolve the project site to outlines.
 *
 * ⚠️ Address layer FIRST, then the COORDINATE — and unlike the properties, the coordinate is
 * the branch that usually answers. A development site's addresses have typically been
 * consolidated into one title and removed from the address layer: all three segments of
 * "1-5 Polding Place, 6 & 12 Sturt Street" are missing from it, and the two that geocode land
 * on the same 9,102 m² lot 7//DP128229 — which IS the site. Trying only the layer (the
 * properties' rule) found nothing at all on that job.
 *
 * Drawn ONLY when a segment resolves to a real parcel. There is deliberately no pin fallback:
 * a numbered pin means "a property we inspected" on this drawing, and the site is neither
 * numbered nor inspected. A site that cannot be placed is reported with its address so the
 * operator can draw it by hand — the shape palette carries the same unfilled red.
 */
export async function resolveCloseoutSite(site: CloseoutSiteAddress): Promise<ResolvedCloseoutSite> {
  const segments = siteAddressSegments(site.street);
  if (segments.length === 0) {
    return { lots: [], unresolved: site.street ? [{ address: site.street, reason: "No street address on the Opportunity" }] : [] };
  }

  const lots: CloseoutSiteLot[] = [];
  const unresolved: { address: string; reason: string }[] = [];

  const results = await mapPool(segments, CONCURRENCY, async (segment) => {
    if (!HOUSE_NUMBER_START.test(segment)) {
      return { segment, error: "Not a street address — no house number" as string, lot: null };
    }
    if (!site.state || !CADASTRE_STATES.has(site.state)) {
      return {
        segment,
        error: site.state ? `No cadastre for ${site.state}` : "No state on the Opportunity",
        lot: null,
      };
    }

    let point: LatLng;
    try {
      const hit = await geocodeViaGoogle(addressLine(segment, site));
      // ⚠️ `no_candidates` covers "nothing matched" AND "matched only to a suburb/postcode/
      // state". Both mean the same thing here: we do not know where this is, so we draw
      // nothing. A quarter of these values are project names, and this is what stops one being
      // drawn as a confident red lot over somebody's suburb.
      if (hit.status !== "ok") {
        return { segment, error: "Couldn't be located to a street address", lot: null };
      }
      if (!SITE_LOCATION_TYPES.has(hit.locationType ?? "") || hit.plusCode) {
        return { segment, error: "Couldn't be located to a building", lot: null };
      }
      point = { lat: hit.y, lng: hit.x };
    } catch (e) {
      return { segment, error: `Geocode failed (${(e as Error).message})`, lot: null };
    }

    const state = site.state as StandardMarkupState;
    const found =
      (await parcelByAddress(state, segment, site.suburb ?? "", point)) ??
      // The usual branch for a site: the address layer no longer lists it because the lots were
      // consolidated. Never throws — parcelAtPoint can, so this is guarded.
      (await parcelAtPoint(state, point)
        .then((parcel) =>
          parcel && parcel.kind === "lot"
            ? { ring: parcel.ring, areaSqm: parcel.areaSqm, lotPlan: parcel.idKey ?? null, point, note: null }
            : null
        )
        .catch(() => null));

    if (!found || !found.ring) {
      return { segment, error: "No titled parcel at that address", lot: null };
    }
    return {
      segment,
      error: null,
      lot: {
        id: `site:${segment}`,
        ring: found.ring,
        areaSqm: found.areaSqm,
        lotPlan: found.lotPlan,
        point: found.point,
        address: segment,
      } satisfies CloseoutSiteLot,
    };
  });

  // ⚠️ Deduped on the LOT. A consolidated development site answers several of its own street
  // addresses with one title — "1-5 Polding Place" and "6 Sturt Street" are both 7//DP128229 —
  // and drawing it once per address would double-stroke the outline and list the site twice.
  // The addresses are merged into one label so nothing is lost by collapsing them.
  const byLot = new Map<string, CloseoutSiteLot>();
  for (const r of results) {
    if (!r.lot) {
      unresolved.push({ address: r.segment, reason: r.error ?? "Couldn't be placed" });
      continue;
    }
    // No lot/plan to key on (VIC's property fallback publishes none) — keep it on its own.
    const key = r.lot.lotPlan ?? r.lot.id;
    const seen = byLot.get(key);
    if (seen) seen.address = `${seen.address}, ${r.lot.address}`;
    else byLot.set(key, { ...r.lot });
  }
  lots.push(...byLot.values());
  return { lots, unresolved };
}

/** The Site_Address__c components, as the SOQL returns them. */
export function siteAddressFrom(
  street: string | null,
  city: string | null,
  state: string | null,
  postcode: string | null
): CloseoutSiteAddress | null {
  if (!street && !city) return null;
  const line = [street, city, [state, postcode].filter(Boolean).join(" ")]
    .filter((p) => p && p.trim())
    .join(", ");
  return {
    line,
    street: street?.trim() || null,
    suburb: city?.trim() || null,
    state: (state?.trim().toUpperCase() as AuStateCode) || null,
    postcode: postcode?.trim() || null,
  };
}
