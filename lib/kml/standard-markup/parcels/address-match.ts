// Does an address-layer feature answer the address the operator typed? Pure string work, so it
// can be checked offline (scripts/check-address-match.ts).
//
// Why this exists: Google's geocoder will happily put "44 Eastern Ave" and "42 Eastern Ave" on
// the same point, and "13 Craig Ave" on 12's lot across the road — interpolated positions that
// pass every precision test and then hand the cadastre the wrong parcel. The state address
// layers know exactly which property is No. 44. Matching their strings against the request is
// what lets ./verify-address.ts catch and correct the geocoder.

/** Australian road-type abbreviations → the full word the address layers use. Both directions
 *  are normalised to the FULL word, so "Ave" and "AVENUE" compare equal. */
const ROAD_TYPES: Record<string, string> = {
  AVE: "AVENUE", AV: "AVENUE",
  ST: "STREET",
  RD: "ROAD",
  CT: "COURT", CRT: "COURT",
  DR: "DRIVE", DVE: "DRIVE",
  PL: "PLACE",
  CRES: "CRESCENT", CR: "CRESCENT",
  TCE: "TERRACE",
  HWY: "HIGHWAY",
  PDE: "PARADE",
  CL: "CLOSE",
  LN: "LANE",
  BVD: "BOULEVARD", BLVD: "BOULEVARD",
  CCT: "CIRCUIT",
  ESP: "ESPLANADE",
  GR: "GROVE",
  SQ: "SQUARE",
  FWY: "FREEWAY",
  PKWY: "PARKWAY",
  PROM: "PROMENADE",
  CIR: "CIRCLE",
  ENT: "ENTRANCE",
  QY: "QUAY",
  TRK: "TRACK",
};

/** Upper-case, single-spaced, punctuation stripped, road types spelt out. */
export function normaliseRoad(text: string): string {
  return text
    .toUpperCase()
    .replace(/[.,']/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ROAD_TYPES[w] ?? w)
    .join(" ");
}

export interface HouseNumber {
  from: string;
  to?: string;
}

/** "42", "38A", "51-53", "67-77" → from/to. Null when the text has no leading number. */
export function parseHouseNumber(text: string): HouseNumber | null {
  const m = text.trim().match(/^(\d+[A-Z]?)(?:\s*-\s*(\d+[A-Z]?))?/i);
  if (!m) return null;
  return { from: m[1].toUpperCase(), to: m[2]?.toUpperCase() };
}

/** Drops a leading unit — "Unit 1/48 …", "1/48 …", "U 6 48 …" — and returns the street with
 *  the house number at the front, which is what an address layer's principal address carries. */
export function stripUnit(street: string): string {
  return street
    .trim()
    .replace(/^(?:unit|apartment|apt|u)\s*\.?\s*\d+[a-z]?\s*[/,]?\s*(?=\d)/i, "")
    .replace(/^\d+[a-z]?\s*\/\s*(?=\d)/i, "")
    .trim();
}

function numeric(n: string): number {
  return parseInt(n, 10);
}

/** The requested number is one the feature answers to: equal to either end, or inside the
 *  feature's range with the same parity (a "67-77" property is 67, 69, … 77 — not 68). */
export function houseNumberMatches(requested: HouseNumber, feature: HouseNumber): boolean {
  const asked = [requested.from, requested.to].filter(Boolean) as string[];
  const has = [feature.from, feature.to].filter(Boolean) as string[];
  if (asked.some((a) => has.includes(a))) return true;
  if (feature.to) {
    const lo = numeric(feature.from);
    const hi = numeric(feature.to);
    return asked.some((a) => {
      const n = numeric(a);
      return n >= lo && n <= hi && (n - lo) % 2 === 0;
    });
  }
  return false;
}

export interface AddressFeatureLike {
  /** The feature's own house number text, e.g. "44", "67-77", "38A". */
  number: string;
  /** Everything after the number, e.g. "EASTERN AVENUE DOVER HEIGHTS" or "Albany Creek Road Aspley". */
  rest: string;
}

/**
 * The feature that IS the requested address, or null. Number must match (see above) and the
 * feature's road must start with the requested road — "EASTERN AVENUE DOVER HEIGHTS" starts
 * with "EASTERN AVENUE", so the suburb never has to be split off. When several features match
 * (a property polygon per unit, say), one whose text also carries the suburb wins.
 */
export function findAddressFeature<T extends AddressFeatureLike>(
  features: T[],
  requested: { street: string; suburb: string }
): T | null {
  const base = stripUnit(requested.street);
  const number = parseHouseNumber(base);
  if (!number) return null;
  const road = normaliseRoad(base.replace(/^\d+[A-Z]?(?:\s*-\s*\d+[A-Z]?)?\s*/i, ""));
  if (!road) return null;
  const suburb = normaliseRoad(requested.suburb);

  const hits = features.filter((f) => {
    const fn = parseHouseNumber(f.number);
    if (!fn || !houseNumberMatches(number, fn)) return false;
    const rest = normaliseRoad(f.rest);
    return rest === road || rest.startsWith(`${road} `);
  });
  if (hits.length === 0) return null;
  if (hits.length === 1 || !suburb) return hits[0];
  return hits.find((f) => normaliseRoad(f.rest).includes(suburb)) ?? hits[0];
}
