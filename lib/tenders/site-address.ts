import { parseLocality } from "./salesforce-match";

/**
 * Turning a tender's stated location into Salesforce address fields.
 *
 * ── Why this is not just "put the string somewhere" ──────────────────────────────────────
 *
 * The first version assigned the raw location to STREET, so TW-HTUUT arrived in the flow as
 * street "City of Stonnington, VIC" / city "CITY OF STONNINGTON" — a council name in a field
 * meant for a street, and the same text twice. A tender almost never states a street: at
 * tender stage the work spans a council area, a corridor or a precinct, which is exactly what
 * the string describes.
 *
 * So street stays BLANK unless the text really contains one, and the council noise is
 * stripped off the locality.
 */

/**
 * Words that mean "this is a local government area", not a suburb.
 *
 * ⚠️ Kept separate from the trailing-noise list below because this also decides whether a
 * POSTCODE can be looked up at all — see `isLga`.
 */
const LGA_WORDS = /\b(council|shire|municipality|regional|city of|borough)\b/i;

/** Decoration councils add to their own name that is not part of the place. */
const TRAILING_NOISE =
  /\s*\b(council\s+lga|council\s+area|council|shire\s+council|shire|lga|road\s+network|roads?|region|regional\s+council|municipality)\b\s*/gi;

/** "City of Stonnington" -> "Stonnington". Leading forms, which a trailing strip cannot see. */
const LEADING_NOISE = /^\s*(city\s+of|shire\s+of|municipality\s+of|town\s+of|borough\s+of)\s+/i;

/** Title Case, because the sources SHOUT and Salesforce does not. */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase())
    // Keep the camel-case brands councils actually use.
    .replace(/\bMidcoast\b/g, "MidCoast");
}

/** A street number followed by a name — the only thing worth putting in a Street field. */
const LOOKS_LIKE_STREET =
  /\b\d+[A-Za-z]?(?:\s*[-/]\s*\d+[A-Za-z]?)?\s+[A-Za-z][A-Za-z' -]*\b(street|st|road|rd|avenue|ave|drive|dr|highway|hwy|parade|pde|lane|ln|crescent|cres|terrace|tce|place|pl|court|ct|way|close|boulevard|blvd)\b/i;

export type SiteAddress = {
  street: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  /**
   * True when the place is a COUNCIL AREA rather than a suburb.
   *
   * ⚠️ This is why postcode stays null for most tenders. "Stonnington" is an LGA covering
   * Prahran, South Yarra, Malvern, Toorak, Windsor and Armadale — there is no single correct
   * postcode, and filling in one of them would put a specific wrong answer on an Opportunity
   * where a blank would have prompted someone to check.
   */
  isLga: boolean;
};

export function siteAddressFrom(raw: string | null | undefined): SiteAddress {
  const empty: SiteAddress = { street: null, city: null, state: null, postcode: null, isLga: false };
  if (!raw?.trim()) return empty;

  // ⚠️ Find the street FIRST and take it out before reading the locality. parseLocality
  // treats everything before the state as the suburb, so "26 Rankin Rd, Hastings VIC" would
  // otherwise come back as the city "26 Rankin Rd Hastings" — the street twice, once in the
  // wrong field.
  const streetMatch = LOOKS_LIKE_STREET.exec(raw);
  const withoutStreet = streetMatch ? raw.replace(streetMatch[0], " ").replace(/^[\s,]+/, "") : raw;

  const locality = parseLocality(withoutStreet);
  const state = locality?.state ?? null;

  // A postcode that is already in the text is a FACT, not a guess — keep it.
  const postcode = /\b(\d{4})\b/.exec(raw.replace(/\b\d{4}\b(?=\s*(?:st|nd|rd|th)\b)/gi, ""))?.[1] ?? null;

  const street = streetMatch ? streetMatch[0].trim().slice(0, 255) : null;

  let city: string | null = null;
  if (locality?.suburb) {
    const cleaned = locality.suburb
      .replace(LEADING_NOISE, "")
      .replace(TRAILING_NOISE, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/[,\s]+$/, "")
      .trim();
    city = cleaned ? titleCase(cleaned) : null;
  }

  return {
    street,
    city,
    state,
    // Only ever a postcode the source itself stated.
    postcode: postcode && postcode !== city ? postcode : null,
    isLga: LGA_WORDS.test(raw),
  };
}
