// Orchestrator — route each address to its state's lot provider, detect
// shared strata parcels, then estimate building attributes (levels + dwelling
// area) for every resolved parcel.

import type { AuStateCode, ParsedAddress, SizingResult, LotResult } from "./types";
import { lookupQld } from "./qld";
import { lookupNsw } from "./nsw";
import { lookupVic } from "./vic";
import { estimateBuilding } from "./building";
import { mapPool } from "@/lib/util/map-pool";
import { houseNumber } from "./parse";

/** States with an automated lot-size source wired up. Grows per the rollout plan. */
const PROVIDERS: Partial<Record<AuStateCode, (a: ParsedAddress) => Promise<LotResult>>> = {
  QLD: lookupQld,
  NSW: lookupNsw,
  VIC: lookupVic,
};

export function displayStreet(addr: ParsedAddress): string {
  return addr.unit ? `Unit ${addr.unit}/${addr.street}` : addr.street;
}

interface WorkRow {
  addr: ParsedAddress;
  result: SizingResult;
  lon?: number;
  lat?: number;
  parcelRings?: number[][][];
}

function emptyResult(addr: ParsedAddress): SizingResult {
  return {
    id: addr.id,
    raw: addr.raw,
    street: displayStreet(addr),
    suburb: addr.suburb,
    state: addr.state,
    postcode: addr.postcode,
    lotSizeSqm: null,
    lotPlan: null,
    matchedAddress: null,
    matchScore: null,
    source: null,
    levels: null,
    levelsConfidence: null,
    dwellingAreaSqm: null,
    dwellingAreaConfidence: null,
    status: "error",
    flags: [],
  };
}

// The geocoder answers a vague query with a confident point. Asked for a No. 42 that it
// cannot place exactly, Google will happily return the No. 41 across the road, and the
// cadastre then hands back a real lot size for the wrong parcel — the row LOOKS resolved.
// So the matched address has to open with the number that was typed. A range ("51-53")
// accepts either end; a matched address with no leading number (QLD's "LOT 5 …") is
// left alone, because there is nothing to compare.
const MATCHED_NUMBER_RE =
  /^\s*(?:(?:unit|u|apt|apartment|shop|suite|lot)\s*\.?\s*\d+[a-z]?\s*[/,]\s*|\d+[a-z]?\s*\/\s*)?(\d+[a-z]?)(?:\s*-\s*(\d+[a-z]?))?\b/i;

export function houseNumberMismatch(street: string, matchedAddress: string | null): string | null {
  if (!matchedAddress) return null;
  const wanted = houseNumber(street);
  if (!wanted) return null;
  const got = matchedAddress.match(MATCHED_NUMBER_RE);
  if (!got) return null;
  const gotFrom = got[1].toUpperCase();
  const gotTo = got[2]?.toUpperCase();
  const accepted = new Set([wanted.from, wanted.to].filter(Boolean));
  if (accepted.has(gotFrom) || (gotTo && accepted.has(gotTo))) return null;
  const gotLabel = gotTo ? `${gotFrom}-${gotTo}` : gotFrom;
  const wantedLabel = wanted.to ? `${wanted.from}-${wanted.to}` : wanted.from;
  return `geocoder matched No. ${gotLabel}, not No. ${wantedLabel} — check the address / measure manually`;
}

async function lookupLot(addr: ParsedAddress): Promise<WorkRow> {
  const result = emptyResult(addr);
  const provider = addr.state ? PROVIDERS[addr.state] : undefined;
  if (!provider) {
    result.status = "unsupported_state";
    result.flags = [
      addr.state
        ? `${addr.state} not yet automated — measure manually (coming soon)`
        : "state unknown — verify address / measure manually",
    ];
    return { addr, result };
  }
  const { _lon, _lat, _parcelRings, ...lot } = await provider(addr);
  Object.assign(result, lot);
  result.flags = lot.flags ?? [];
  const mismatch = houseNumberMismatch(addr.street, result.matchedAddress);
  if (mismatch && result.status === "ok") {
    result.status = "number_mismatch";
    result.flags = [...result.flags, mismatch];
  }
  return { addr, result, lon: _lon, lat: _lat, parcelRings: _parcelRings };
}

/**
 * Address → parcel, for every address, with the cadastre ring kept. The multi-property markup
 * (Markup and Measure's *DEV* tab) draws from this; it wants the boundary, not the building
 * estimate, so estimateBuilding() is deliberately not run here.
 */
export async function lookupParcels(
  addresses: ParsedAddress[]
): Promise<{ addr: ParsedAddress; result: SizingResult; parcelRings?: number[][][] }[]> {
  return mapPool(addresses, 5, async (addr) => {
    const w = await lookupLot(addr);
    return { addr: w.addr, result: w.result, parcelRings: w.parcelRings };
  });
}

export async function sizeProperties(addresses: ParsedAddress[]): Promise<SizingResult[]> {
  const rows = await mapPool(addresses, 5, lookupLot);

  // Shared-parcel (strata) detection: the same lotplan on >1 row is ONE piece of
  // land shared across units — flag it, and use the count for per-unit sizing.
  const counts = new Map<string, number>();
  for (const w of rows) if (w.result.lotPlan) counts.set(w.result.lotPlan, (counts.get(w.result.lotPlan) ?? 0) + 1);
  for (const w of rows) {
    const n = w.result.lotPlan ? counts.get(w.result.lotPlan) ?? 0 : 0;
    if (n > 1) {
      w.result.flags = [...w.result.flags, `shared parcel — ${n} rows on ${w.result.lotPlan} (strata: don't double-count land)`];
    }
  }

  // Building attributes — computed once per unique parcel and shared across its
  // rows, so strata units are consistent and we don't hammer the endpoint.
  const groups = new Map<string, WorkRow[]>();
  for (const w of rows) {
    if (w.result.status !== "ok") continue;
    const key = w.result.lotPlan ?? (w.lon != null ? `${w.lon},${w.lat}` : null);
    if (!key) continue;
    const arr = groups.get(key);
    if (arr) arr.push(w);
    else groups.set(key, [w]);
  }
  await mapPool(Array.from(groups.values()), 4, async (group) => {
    const rep = group.find((w) => w.parcelRings || w.lon != null) ?? group[0];
    const units = group.length;
    const est = await estimateBuilding({
      state: rep.addr.state,
      lon: rep.lon,
      lat: rep.lat,
      parcelRings: rep.parcelRings,
      lotSizeSqm: rep.result.lotSizeSqm,
      isUnit: units > 1 || group.some((w) => !!w.addr.unit),
      unitsOnParcel: units,
    });
    for (const w of group) {
      w.result.levels = est.levels;
      w.result.levelsConfidence = est.levelsConfidence;
      w.result.dwellingAreaSqm = est.dwellingAreaSqm;
      w.result.dwellingAreaConfidence = est.dwellingAreaConfidence;
      w.result.flags = [...w.result.flags, ...est.flags];
    }
  });

  return rows.map((w) => w.result);
}

export type { SizingResult } from "./types";
