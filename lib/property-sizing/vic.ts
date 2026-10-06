// Victoria lot-size lookup.
// Pipeline: address -> Google Geocoding API -> the markup's parcelAtPoint (Vicmap_Parcel, with
// its Vicmap_Property fallback) -> area computed from the ring, in m².
//
// VIC has no working equivalent of QLD's QldLocator / NSW's NSWPoint dedicated
// geocoder. The obvious candidate — the Vicmap_Address ArcGIS Online hosted
// FeatureServer, queried with a house_number/road_name/locality WHERE clause — was
// used here previously, but live testing showed it regularly takes 25-30s+ and often
// times out entirely (confirmed: not caused by the LIKE wildcard — an exact-match
// query was equally slow). It's a generic hosted feature layer being queried like a
// database table, not a real geocoding service. A separate-looking GeocodeServer at
// corp-geo.mapshare.vic.gov.au/.../VMAddressEZIAdd turned out to be an unconfigured
// generic Esri World Geocoder template (returns nonsense POI matches). Vicmap_Parcel
// itself (the actual cadastral data — the thing only VIC government has) is a fast
// spatial query, not attribute filtering — though not always UP, hence the fallback the
// markup stack carries and this now shares. GOOGLE_MAPS_API_KEY is already provisioned
// for Site Markup's Static Maps calls and already needs the Geocoding API enabled
// alongside it (see .env.local.example) — no new setup.

import type { LotResult } from "./types";
import { geocodeViaGoogle, type GoogleGeocodeOutcome } from "./google-geocode";
import { ringAreaSqm } from "@/lib/kml/standard-markup/geometry";
// ⚠️ A circular import: parcels/vic.ts imports geocodeVic/splitStreet from here. Safe only while
// nothing on the loop reads an import at LOAD time except a function declaration (hoisted) —
// parcel-at-point's PROVIDERS map is the one that does.
import { parcelAtPoint } from "@/lib/kml/standard-markup/parcel-at-point";
import { isPropertyFallbackId, lotPlanFromId } from "@/lib/kml/standard-markup/parcels/parcel-id";
import type { ParcelFeature } from "@/lib/kml/standard-markup/parcels/types";
import { arcgisRingsFromLatLng } from "./rings";

/** Split "8 Ironwood Ct" into a house number + road name, dropping the road type
 *  (VIC's road_name field excludes it) so "Ct" vs "Court" can't cause a mismatch. */
export function splitStreet(street: string): { houseNumber: string; roadName: string } | null {
  const m = street.trim().match(/^(\d+[a-z]?)\s+(.+?)(?:\s+[a-z]+)?$/i);
  if (!m) return null;
  const words = m[2].trim().split(/\s+/);
  // Drop a trailing road-type word (Ct, Court, St, Street, etc.) if there's more than one word.
  const roadName = words.length > 1 ? words.slice(0, -1).join(" ") : words[0];
  return { houseNumber: m[1], roadName };
}

export type VicGeocodeOutcome = GoogleGeocodeOutcome;

/** Geocodes a VIC address via Google (see the file-header comment for why — Vicmap has
 *  no working dedicated geocoder). */
export async function geocodeVic(
  split: { houseNumber: string; roadName: string },
  addr: { suburb: string; postcode?: string }
): Promise<VicGeocodeOutcome> {
  const addressLine = `${split.houseNumber} ${split.roadName}, ${addr.suburb} VIC${
    addr.postcode ? ` ${addr.postcode}` : ""
  }, Australia`;
  return geocodeViaGoogle(addressLine);
}

export async function lookupVic(addr: { street: string; suburb: string; postcode?: string }): Promise<LotResult> {
  const split = splitStreet(addr.street);
  if (!split) {
    return { status: "not_found", flags: ["couldn't parse a house number from the street — verify manually"] };
  }

  let geo: VicGeocodeOutcome;
  try {
    geo = await geocodeVic(split, addr);
  } catch (e) {
    return { status: "error", flags: [`geocode failed: ${(e as Error).message}`] };
  }
  if (geo.status === "no_candidates") {
    return { status: "not_found", flags: ["address not found — verify / measure manually"] };
  }
  if (geo.status === "no_location") {
    return {
      status: "not_found",
      matchedAddress: geo.matchedAddress,
      flags: ["address matched but had no location — verify manually"],
    };
  }

  const { x, y, matchedAddress } = geo;

  // The markup's own point lookup, NOT a query of our own. ⚠️ This used to ask Vicmap_Parcel
  // directly, so it had none of parcels/vic.ts's Vicmap_Property fallback — and that layer did go
  // down in production (2026-09-08). Both layers failing still THROWS, and lands below as an
  // error, never as "no parcel": an outage must not blame the address (lib/arcgis.ts).
  let parcel: ParcelFeature | null;
  try {
    parcel = await parcelAtPoint("VIC", { lat: y, lng: x });
  } catch (e) {
    return { status: "error", matchedAddress, _lon: x, _lat: y, flags: [`cadastre failed: ${(e as Error).message}`] };
  }
  if (!parcel) {
    return {
      status: "no_parcel",
      matchedAddress,
      _lon: x,
      _lat: y,
      flags: ["no titled parcel at this point — measure manually"],
    };
  }
  return {
    status: "ok",
    // Area from the ring, never Shape__Area: Vicmap publishes areas in Web Mercator, inflated by
    // 1/cos²(latitude) — 1.6x at Melbourne. 68 Mason St Newport read 448 m² here against the
    // 279 m² Building Markup measured from the same ring. Same rule the markup applies.
    lotSizeSqm: Math.round(ringAreaSqm(parcel.ring)),
    // Null on the fallback: a property PFI is not a title reference (parcels/parcel-id.ts).
    lotPlan: lotPlanFromId(parcel.idKey),
    matchedAddress,
    matchScore: null,
    source: "VIC Vicmap Property",
    _lon: x,
    _lat: y,
    _parcelRings: arcgisRingsFromLatLng(parcel.ring),
    flags: isPropertyFallbackId(parcel.idKey)
      ? ["VIC's parcel cadastre was unavailable — property boundary from Vicmap Property, no lot/plan. Check the outline before quoting."]
      : [],
  };
}
