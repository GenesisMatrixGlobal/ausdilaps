// Orchestrates the Standard Mark Up pipeline: geocode + envelope-query the subject's
// state cadastre -> identify the subject parcel and its true neighbours.

import type { LatLng } from "@/lib/kml/types";
import { identifySubjectAndNeighbours } from "./neighbours";
import { fetchParcelsNsw } from "./parcels/nsw";
import { fetchParcelsQld } from "./parcels/qld";
import type { ParcelQueryResult } from "./parcels/types";
import { fetchParcelsVic } from "./parcels/vic";

export type StandardMarkupState = "QLD" | "NSW" | "VIC";
export type StandardMarkupStatus = "ok" | "not_found" | "no_parcel" | "error";

export interface StandardMarkupNeighbour {
  /** Stable id (the parcel's lotplan/lotidstring/parcel_spi) — used to exclude it on a later re-render. */
  id: string;
  ring: LatLng[];
  areaSqm: number | null;
}

export interface StandardMarkupResult {
  status: StandardMarkupStatus;
  subjectRing: LatLng[];
  neighbours: StandardMarkupNeighbour[];
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

function emptyResult(status: StandardMarkupStatus, matchedAddress: string | null, flags: string[]): StandardMarkupResult {
  return { status, subjectRing: [], neighbours: [], matchedAddress, flags };
}

/** A parcel's own idKey can be blank if the source cadastre had no plan/lot attributes
 *  for it — fall back to a positional id so every neighbour still gets something stable
 *  and unique to reference across a generate -> exclude -> re-render round trip. */
function toStandardMarkupNeighbours(
  neighbours: { idKey: string; ring: LatLng[]; areaSqm: number | null }[]
): StandardMarkupNeighbour[] {
  return neighbours.map((n, i) => ({ id: n.idKey || `n${i}`, ring: n.ring, areaSqm: n.areaSqm }));
}

export async function resolveStandardMarkup(
  addr: { street: string; suburb: string; postcode?: string },
  state: StandardMarkupState
): Promise<StandardMarkupResult> {
  let parcelResult: ParcelQueryResult | null;
  try {
    parcelResult = await PARCEL_PROVIDERS[state](addr);
  } catch (e) {
    const message = (e as Error).message;
    console.error(`[standard-markup] ${state} lookup failed`, {
      street: addr.street,
      suburb: addr.suburb,
      postcode: addr.postcode,
      message,
    });
    return emptyResult("error", null, [message]);
  }
  if (!parcelResult) {
    return emptyResult("not_found", null, ["address not found — verify / measure manually"]);
  }

  const subjectAndNeighbours = identifySubjectAndNeighbours(parcelResult.point, parcelResult.candidates);
  if (!subjectAndNeighbours) {
    return emptyResult("no_parcel", parcelResult.matchedAddress, ["no titled parcel at this address — measure manually"]);
  }
  const { subject, neighbours, flags } = subjectAndNeighbours;

  return {
    status: "ok",
    subjectRing: subject.ring,
    neighbours: toStandardMarkupNeighbours(neighbours),
    matchedAddress: parcelResult.matchedAddress,
    flags,
  };
}
