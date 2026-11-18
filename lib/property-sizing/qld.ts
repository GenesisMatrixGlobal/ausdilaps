// Queensland lot-size lookup — free, no API key (Google only as the geocoder's fallback).
// Pipeline (validated live): address -> QldLocator geocode -> point-in-polygon
// query against the DCDB (Land Parcel Property Framework) -> lot_area in m².
// Returns the parcel geometry too, for the building-attributes step.

import type { LotResult } from "./types";
import { fetchJson } from "@/lib/fetch-json";
import { arcgisErrorMessage } from "@/lib/arcgis";
import { findAddressFeature, normaliseRoad, stripUnit } from "@/lib/kml/standard-markup/parcels/address-match";
import { geocodeViaGoogle } from "./google-geocode";

const GEOCODE_URL =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Location/QldLocator/GeocodeServer/findAddressCandidates";
const CADASTRE_URL =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4/query";

interface GeocodeResp {
  candidates?: {
    address?: string;
    score?: number;
    location?: { x: number; y: number };
    attributes?: { Addr_type?: string; AddNum?: string; StAddr?: string; City?: string };
  }[];
}

// QldLocator always answers with *something*. An address it doesn't hold comes back as the
// suburb's centre ("Rochedale, Queensland", Addr_type "Locality", score ~75) or as the same
// number on a similar road ("10 Ann St" → "10 Ann Crescent", score 97), and the cadastre then
// returns whatever lot sits under that point. Seen live 2026-11-18: 35 Woodcarver St, Rochedale
// — a new-estate lot the locator hadn't caught up with — came back as a 23,820 m² lot at the
// suburb centroid. The score can't tell these apart, so the hit has to be an address AND read
// back as the address that was asked for.
const ADDRESS_LEVEL_TYPES = new Set(["PointAddress", "Subaddress"]);

function isRequestedAddress(
  attrs: NonNullable<NonNullable<GeocodeResp["candidates"]>[number]["attributes"]> | undefined,
  addr: { street: string; suburb: string }
): boolean {
  if (!attrs || !ADDRESS_LEVEL_TYPES.has(attrs.Addr_type ?? "")) return false;
  const number = (attrs.AddNum ?? "").trim();
  const rest = (attrs.StAddr ?? "").trim().replace(/^\S+\s+/, "");
  if (!findAddressFeature([{ number, rest }], addr)) return false;
  // "Brisbane" for "Brisbane City" is the operator's shorthand; a different suburb is a
  // different street that happens to share a name.
  const wanted = normaliseRoad(addr.suburb);
  const got = normaliseRoad(attrs.City ?? "");
  return !wanted || !got || got.startsWith(wanted) || wanted.startsWith(got);
}
interface CadastreResp {
  features?: { attributes?: Record<string, unknown>; geometry?: { rings?: number[][][] } }[];
}


export interface QldGeocodeResult {
  x: number;
  y: number;
  matchedAddress: string | null;
  matchScore: number | null;
}

/**
 * Geocodes a QLD address. QldLocator first — free, no API key — and Google when the locator
 * doesn't hold the address (new estates run months ahead of it). Returns null if neither
 * found the actual address.
 */
export async function geocodeQld(addr: { street: string; suburb: string; postcode?: string }): Promise<QldGeocodeResult | null> {
  const singleLine = [addr.street, addr.suburb, "QLD", addr.postcode].filter(Boolean).join(", ");
  const g = await fetchJson<GeocodeResp>(
    `${GEOCODE_URL}?SingleLine=${encodeURIComponent(singleLine)}&f=json&outSR=4326&maxLocations=1` +
      `&outFields=Addr_type,AddNum,StAddr,City`
  );
  const cand = g.candidates?.[0];
  if (cand?.location && isRequestedAddress(cand.attributes, addr)) {
    return {
      x: cand.location.x,
      y: cand.location.y,
      matchedAddress: cand.address ?? null,
      matchScore: typeof cand.score === "number" ? cand.score : null,
    };
  }

  // Rooftop only, no plus codes: an address the locator lacks is usually missing from the QLD
  // address layer too, so verify-address.ts can't correct an interpolated guess here the way it
  // does for NSW and VIC. Same bar as lib/closeout-markup/site.ts.
  const google = await geocodeViaGoogle(
    `${addr.street}, ${addr.suburb} QLD${addr.postcode ? ` ${addr.postcode}` : ""}, Australia`
  );
  if (google.status !== "ok" || google.locationType !== "ROOFTOP" || google.plusCode) return null;
  // Google guesses too: "10 Ann St, Rochedale" comes back as a rooftop on "10 Anna Marie St,
  // Rochedale South". Its first segment has to read back as the street that was asked for.
  const matchedStreet = stripUnit((google.matchedAddress ?? "").split(",")[0]);
  const number = matchedStreet.match(/^\S+/)?.[0] ?? "";
  if (!findAddressFeature([{ number, rest: matchedStreet.slice(number.length).trim() }], addr)) return null;
  return { x: google.x, y: google.y, matchedAddress: google.matchedAddress, matchScore: null };
}

export async function lookupQld(addr: { street: string; suburb: string; postcode?: string }): Promise<LotResult> {
  let geo: QldGeocodeResult | null;
  try {
    geo = await geocodeQld(addr);
  } catch (e) {
    return { status: "error", flags: [`geocode failed: ${(e as Error).message}`] };
  }
  if (!geo) {
    return { status: "not_found", flags: ["address not found — verify / measure manually"] };
  }

  const { x, y, matchedAddress, matchScore } = geo;

  try {
    const c = await fetchJson<CadastreResp>(
      `${CADASTRE_URL}?geometry=${x},${y}&geometryType=esriGeometryPoint&inSR=4326` +
        `&spatialRel=esriSpatialRelIntersects&outFields=lot,plan,lotplan,lot_area,locality` +
        `&returnGeometry=true&outSR=4326&f=json`
    );
    // An ArcGIS failure arrives as HTTP 200 with an `error` body and no `features`, which
    // read here as "no titled parcel at this point" — blaming the address for an outage.
    // See lib/arcgis.ts.
    const arcgisError = arcgisErrorMessage(c);
    if (arcgisError) {
      return { status: "error", flags: [`The QLD cadastre service rejected the query: ${arcgisError}`] };
    }
    const feat = c.features?.[0];
    const attrs = feat?.attributes;
    const area = attrs?.lot_area;
    if (!attrs || area == null) {
      return {
        status: "no_parcel",
        matchedAddress,
        matchScore,
        _lon: x,
        _lat: y,
        flags: ["no titled parcel at this point — measure manually"],
      };
    }
    return {
      status: "ok",
      lotSizeSqm: Math.round(Number(area)),
      lotPlan: (attrs.lotplan as string) ?? null,
      matchedAddress,
      matchScore,
      source: "QLD DCDB",
      _lon: x,
      _lat: y,
      _parcelRings: feat?.geometry?.rings,
      flags: [],
    };
  } catch (e) {
    return { status: "error", matchedAddress, matchScore, _lon: x, _lat: y, flags: [`cadastre failed: ${(e as Error).message}`] };
  }
}
