// Orchestrates the Standard Mark Up pipeline: geocode + envelope-query the subject's
// state cadastre -> identify the subject parcel and its true neighbours -> fetch the
// local road/footpath network -> compute the corner/frontage highlight extent.

import type { LatLng } from "@/lib/kml/types";
import { bboxAround, fetchRoadNetworkNear } from "@/lib/kml/road-segments/overpass";
import { computeFrontage } from "./frontage";
import { identifySubjectAndNeighbours } from "./neighbours";
import { fetchParcelsNsw } from "./parcels/nsw";
import { fetchParcelsQld } from "./parcels/qld";
import type { ParcelQueryResult } from "./parcels/types";
import { fetchParcelsVic } from "./parcels/vic";

export type StandardMarkupState = "QLD" | "NSW" | "VIC";
export type StandardMarkupStatus = "ok" | "not_found" | "no_parcel" | "error";

export interface StandardMarkupResult {
  status: StandardMarkupStatus;
  subjectRing: LatLng[];
  neighbourRings: LatLng[][];
  /** Road + footpath polylines to render in the fixed "council asset" colour. */
  assets: LatLng[][];
  matchedAddress: string | null;
  flags: string[];
}

const PARCEL_PROVIDERS: Record<
  StandardMarkupState,
  (addr: { street: string; suburb: string; postcode?: string }) => Promise<ParcelQueryResult | null>
> = {
  QLD: fetchParcelsQld,
  NSW: fetchParcelsNsw,
  VIC: fetchParcelsVic,
};

/** Strips a leading house number (incl. unit-range like "12-14" or a letter suffix like "12A")
 *  off a street address to get just the road name, for matching against OSM `name` tags. */
function extractRoadName(street: string): string {
  return street.replace(/^\s*\d+[a-z]?(?:-\d+[a-z]?)?\s*/i, "").trim();
}

function emptyResult(status: StandardMarkupStatus, matchedAddress: string | null, flags: string[]): StandardMarkupResult {
  return { status, subjectRing: [], neighbourRings: [], assets: [], matchedAddress, flags };
}

export async function resolveStandardMarkup(
  addr: { street: string; suburb: string; postcode?: string },
  state: StandardMarkupState
): Promise<StandardMarkupResult> {
  let parcelResult: ParcelQueryResult | null;
  try {
    parcelResult = await PARCEL_PROVIDERS[state](addr);
  } catch (e) {
    return emptyResult("error", null, [(e as Error).message]);
  }
  if (!parcelResult) {
    return emptyResult("not_found", null, ["address not found — verify / measure manually"]);
  }

  const subjectAndNeighbours = identifySubjectAndNeighbours(parcelResult.point, parcelResult.candidates);
  if (!subjectAndNeighbours) {
    return emptyResult("no_parcel", parcelResult.matchedAddress, ["no titled parcel at this address — measure manually"]);
  }
  const { subject, neighbours, flags: subjectFlags } = subjectAndNeighbours;

  const roadName = extractRoadName(addr.street);
  const bbox = bboxAround(parcelResult.point, 0.15);

  try {
    const network = await fetchRoadNetworkNear(bbox);
    const frontage = computeFrontage(subject, neighbours, roadName, network);
    return {
      status: "ok",
      subjectRing: subject.ring,
      neighbourRings: neighbours.map((n) => n.ring),
      assets: frontage.assets,
      matchedAddress: parcelResult.matchedAddress,
      flags: [...subjectFlags, ...frontage.flags],
    };
  } catch (e) {
    return {
      status: "ok",
      subjectRing: subject.ring,
      neighbourRings: neighbours.map((n) => n.ring),
      assets: [],
      matchedAddress: parcelResult.matchedAddress,
      flags: [...subjectFlags, `couldn't fetch road/footpath geometry — lots still shown, road markup skipped (${(e as Error).message})`],
    };
  }
}
