// Orchestrates the Standard Mark Up pipeline: geocode + envelope-query the subject's
// state cadastre -> identify the subject parcel and its true neighbours.

import type { LatLng } from "@/lib/kml/types";
import { identifySubjectAndNeighbours } from "./neighbours";
import { fetchLotAddresses, type LotAddress } from "./parcels/addresses";
import { isPropertyFallbackId, lotPlanFromId } from "./parcels/parcel-id";
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
  /** From the state's own address layer — see parcels/addresses.ts. Null when the layer had
   *  nothing for this lot, or the lookup failed; the sheet then shows an empty, editable cell.
   *  Never a reason for the markup to fail. */
  street: string | null;
  suburb: string | null;
}

export interface StandardMarkupResult {
  status: StandardMarkupStatus;
  subjectRing: LatLng[];
  /** The subject parcel's own lot/plan and area.
   *
   *  Both were already computed and thrown away here — `subject` is a full ParcelFeature
   *  carrying `idKey` and an `areaSqm` from the same ringAreaSqm pass every neighbour gets,
   *  and only its ring was returned. Needed so the site can be a priced layer like any
   *  other, and so the panel can show its size the way it shows a lot's. */
  subjectLotPlan: string | null;
  subjectAreaSqm: number | null;
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
  return {
    status,
    subjectRing: [],
    subjectLotPlan: null,
    subjectAreaSqm: null,
    neighbours: [],
    matchedAddress,
    flags,
  };
}

/** A parcel's own idKey can be blank if the source cadastre had no plan/lot attributes
 *  for it — fall back to a positional id so every neighbour still gets something stable
 *  and unique to reference across a generate -> exclude -> re-render round trip.
 *
 *  Ids must also be unique *within a single result*: the client keys its exclude-set and
 *  its checkboxes off this id, so two neighbours sharing one would toggle and render as a
 *  single parcel. A state cadastre handing back the same identifier for two distinct lots
 *  is a data question we can't settle here, so collisions are suffixed rather than trusted. */
function toStandardMarkupNeighbours(
  neighbours: { idKey: string; ring: LatLng[]; areaSqm: number | null }[],
  addresses: Map<string, LotAddress>
): StandardMarkupNeighbour[] {
  const used = new Set<string>();
  return neighbours.map((n, i) => {
    const base = n.idKey || `n${i}`;
    let id = base;
    for (let dup = 2; used.has(id); dup++) id = `${base}#${dup}`;
    used.add(id);
    // Looked up on the raw idKey, not `id` — the "#2" suffix is invented here to keep the
    // client's checkbox set unique, and the address layer has never heard of it.
    const addr = addresses.get(n.idKey);
    return {
      id,
      ring: n.ring,
      areaSqm: n.areaSqm,
      street: addr?.street ?? null,
      suburb: addr?.suburb ?? null,
    };
  });
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

  // A third round trip, after identifySubjectAndNeighbours because NSW and VIC join on the
  // rings, and before toStandardMarkupNeighbours because that is where duplicate idKeys get
  // their "#2". Cannot throw — see parcels/addresses.ts.
  const lotAddresses = await fetchLotAddresses(
    state,
    neighbours.map((n) => ({ idKey: n.idKey, ring: n.ring })),
    { street: addr.street, suburb: addr.suburb }
  );

  // Said out loud, because the outlines on screen are then property boundaries rather than
  // titled parcels and there is no lot/plan to print — see parcels/vic.ts.
  const fallbackFlags = [subject, ...neighbours].some((p) => isPropertyFallbackId(p.idKey))
    ? [
        "VIC's parcel cadastre was unavailable — these are PROPERTY boundaries from Vicmap Property, " +
          "and lot/plan references aren't available. Check the outlines before quoting.",
      ]
    : [];

  return {
    status: "ok",
    subjectRing: subject.ring,
    subjectLotPlan: lotPlanFromId(subject.idKey),
    subjectAreaSqm: subject.areaSqm,
    neighbours: toStandardMarkupNeighbours(neighbours, lotAddresses.byIdKey),
    matchedAddress: parcelResult.matchedAddress,
    flags: [...flags, ...fallbackFlags, ...lotAddresses.flags],
  };
}
