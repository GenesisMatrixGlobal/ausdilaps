// Address parsing — turn free text / OCR components into ParsedAddress records.
//
// The text tab is fed straight from Excel, so a "line" is usually a ROW of cells joined
// by tabs (or, when the sheet was built with formulas, by runs of spaces). Two things
// that went wrong before this was column-aware, both on the same Vaucluse job:
//
//   "11  CRAIG AVE  VAUCLUSE NSW 2030"  → the "ID<tab>ADDRESS" rule took the street
//   NUMBER as the row's ref and looked up "CRAIG AVE, VAUCLUSE" with no number at all.
//   Google then pinned whatever it liked on the street — a No. 41 came back for a No. 42
//   — and the cadastre returned a convincing lot size for the wrong parcel.
//
//   "42 EASTERN AVE DOVER HEIGHTS NSW 2030" → with no comma, the suburb was "the last
//   word", so a two-word suburb became street "42 EASTERN AVE DOVER", suburb "HEIGHTS".
//
// Now: a leading cell is a ref ONLY if what follows already starts with a street number;
// number-only cells are merged into the street; the cell carrying the state is the suburb
// cell; and a single-cell line finds the suburb by the street TYPE ("AVE", "ST", …).

import type { AuStateCode, ParsedAddress } from "./types";

const STATES: AuStateCode[] = ["QLD", "NSW", "VIC", "SA", "WA", "TAS", "ACT", "NT"];
const STATE_RE = new RegExp(`\\b(${STATES.join("|")})\\b`, "i");
const POSTCODE_RE = /\b(\d{4})\b/;

// Leading unit designators: "UNIT 103/8 …", "Unit 12 88 …", "U 5/10 …", "103/8 …".
// Longest keyword first, and the unit token must be a number (so "u" can't eat the
// "U" of "Unit" and leave "nit" as the unit).
const UNIT_RE = /^\s*(?:unit|apartment|apt|u)\s*\.?\s*(\d+[a-z]?)\s*[/,]?\s*(?=\d)/i;
const SLASH_UNIT_RE = /^\s*(\d+[a-z]?)\s*\/\s*(?=\d)/i;
const UNIT_KEYWORD_RE = /^\s*(?:unit|apartment|apt|u|lot)\b/i;

/** A house number as it appears at the front of a street: "42", "12A", "51-53". */
const HOUSE_NUMBER_RE = /^(\d+[a-z]?)(?:\s*-\s*(\d+[a-z]?))?/i;

/** Does this text open with a street number (optionally behind a unit)? */
const STARTS_WITH_NUMBER_RE =
  /^\s*(?:(?:unit|apartment|apt|u|lot)\s*\.?\s*\d+[a-z]?\s*[/,]?\s*|\d+[a-z]?\s*\/\s*)?\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?\b/i;

// Street types that are unambiguous — a word that is only ever the TYPE, never a plausible
// name word. Deliberately excludes HILL, PARK, RIDGE, LAKE, GREEN, HEIGHTS, POINT, VIEW
// and friends: those are valid types but appear inside names ("Green Hill Rd") and suburbs
// ("Park Ridge", "Chapel Hill") far more often than they end a street.
const STREET_TYPES = new Set([
  "AVE", "AV", "AVENUE",
  "ST", "STREET",
  "RD", "ROAD",
  "CT", "CRT", "COURT",
  "DR", "DVE", "DRIVE",
  "PL", "PLACE",
  "CRES", "CR", "CRESCENT",
  "TCE", "TERRACE",
  "HWY", "HIGHWAY",
  "PDE", "PARADE",
  "CL", "CLOSE",
  "WAY",
  "LANE", "LN",
  "BVD", "BLVD", "BOULEVARD",
  "CCT", "CIRCUIT",
  "ESP", "ESPLANADE",
  "GR", "GROVE",
  "RISE",
  "LOOP",
  "MEWS",
  "SQ", "SQUARE",
  "BEND",
  "FWY", "FREEWAY",
  "PKWY", "PARKWAY",
  "PROM", "PROMENADE",
  "CIR", "CIRCLE",
  "ENT", "ENTRANCE",
  "QUAY", "QY",
  "CHASE",
  "VISTA",
  "ALLEY",
  "TRK", "TRACK",
]);

const STATE_ALIASES: Record<string, AuStateCode> = {
  queensland: "QLD",
  "new south wales": "NSW",
  victoria: "VIC",
  "south australia": "SA",
  "western australia": "WA",
  tasmania: "TAS",
  "australian capital territory": "ACT",
  "northern territory": "NT",
};

export function normalizeState(s?: string | null): AuStateCode | undefined {
  if (!s) return undefined;
  const t = s.trim();
  const upper = t.toUpperCase();
  if ((STATES as string[]).includes(upper)) return upper as AuStateCode;
  return STATE_ALIASES[t.toLowerCase()];
}

/** The house number at the front of a street string, as a range ("51-53" → 51…53).
 *  `null` when the street doesn't open with a number (e.g. "LOT 5 SMITH RD"). */
export function houseNumber(street: string): { from: string; to?: string } | null {
  const m = street.trim().match(HOUSE_NUMBER_RE);
  if (!m) return null;
  return { from: m[1].toUpperCase(), to: m[2]?.toUpperCase() };
}

/** Split "42 EASTERN AVE DOVER HEIGHTS" (state + postcode already removed) into street
 *  and suburb. The street ends at the first street-type word that has at least one name
 *  word in front of it — "12 ST GEORGES TCE PERTH" must not stop at "ST". Falls back to
 *  "the last word is the suburb" when no type word is present. */
function splitStreetSuburb(tail: string): { street: string; suburb: string } {
  const parts = tail.split(" ").filter(Boolean);
  if (parts.length < 2) return { street: tail, suburb: "" };
  // Index 0 is the number (or a unit-less first word); a type needs a name before it.
  const firstNameIdx = HOUSE_NUMBER_RE.test(parts[0]) ? 1 : 0;
  for (let i = firstNameIdx + 1; i < parts.length - 1; i++) {
    if (STREET_TYPES.has(parts[i].toUpperCase())) {
      return { street: parts.slice(0, i + 1).join(" "), suburb: parts.slice(i + 1).join(" ") };
    }
  }
  return { street: parts.slice(0, -1).join(" "), suburb: parts.slice(-1).join(" ") };
}

export function parseAddressLine(raw: string, id?: string): ParsedAddress | null {
  const original = raw.trim();
  if (!original) return null;
  let work = original.replace(/\s+/g, " ");

  // Unit / strata.
  let unit: string | undefined;
  const u = work.match(UNIT_RE);
  if (u) {
    unit = u[1];
    work = work.slice(u[0].length).trim();
  } else {
    const sl = work.match(SLASH_UNIT_RE);
    if (sl) {
      unit = sl[1];
      work = work.slice(sl[0].length).trim();
    }
  }

  const state = normalizeState(work.match(STATE_RE)?.[1]);
  const postcode = work.match(POSTCODE_RE)?.[1];

  // Split street vs suburb — prefer the last comma as the boundary.
  let street = work;
  let suburb = "";
  const lastComma = work.lastIndexOf(",");
  if (lastComma >= 0) {
    street = work.slice(0, lastComma).trim();
    suburb = work
      .slice(lastComma + 1)
      .replace(STATE_RE, " ")
      .replace(POSTCODE_RE, " ")
      .replace(/\s+/g, " ")
      .trim();
  } else if (state) {
    // No comma: strip trailing "STATE POSTCODE", then find where the street ends.
    let tail = work;
    if (postcode) tail = tail.replace(new RegExp(`\\s*${postcode}\\s*$`), "").trim();
    const idx = tail.toUpperCase().lastIndexOf(state);
    if (idx > 0) {
      const split = splitStreetSuburb(tail.slice(0, idx).trim());
      street = split.street;
      suburb = split.suburb;
    }
  }

  street = street.replace(/,+\s*$/, "").trim();
  return { id, raw: original, unit, street, suburb, state, postcode };
}

/** Is this cell nothing but numbers and unit words — "42", "51-53", "U 1", "1/48"? */
function isNumericCell(cell: string): boolean {
  return cell
    .split(/\s+/)
    .every((tok) => /^(?:unit|apartment|apt|u|lot)$/i.test(tok) || /^\d+[a-z]?(?:-\d+[a-z]?)?(?:\/\d+[a-z]?)?$/i.test(tok));
}

/** Excel gives us a row's cells joined by tabs; a formula-built sheet gives runs of spaces. */
function splitCells(line: string): string[] {
  return line
    .split(/\t+|\s{2,}/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Parse one row of cells. `id` has already been peeled off if there was one. */
function parseAddressCells(cells: string[], id?: string, raw?: string): ParsedAddress | null {
  // Fold number-only cells forward: ["U 1", "48", "EASTERN AVE", …] → ["U 1 48 EASTERN AVE", …].
  const merged: string[] = [];
  let carry = "";
  for (const cell of cells) {
    if (isNumericCell(cell)) {
      carry = carry ? `${carry} ${cell}` : cell;
      continue;
    }
    merged.push(carry ? `${carry} ${cell}` : cell);
    carry = "";
  }
  if (carry) merged.push(carry);

  if (merged.length === 1) {
    const parsed = parseAddressLine(merged[0], id);
    return parsed && raw ? { ...parsed, raw } : parsed;
  }

  // The cell carrying the state is the suburb cell — unless the state sits alone in its
  // own cell ("DOVER HEIGHTS" | "NSW" | "2030"), in which case the suburb is the cell before.
  const stateIdx = merged.findIndex((c) => STATE_RE.test(c));
  let suburbIdx: number;
  if (stateIdx < 0) {
    suburbIdx = merged.length - 1;
  } else {
    const stripped = merged[stateIdx].replace(STATE_RE, " ").replace(POSTCODE_RE, " ").trim();
    suburbIdx = stripped || stateIdx === 0 ? stateIdx : stateIdx - 1;
  }
  if (suburbIdx <= 0) {
    // Everything is in the first cell; the rest is trailing columns. Let the line parser cope.
    const parsed = parseAddressLine(merged.join(" "), id);
    return parsed && raw ? { ...parsed, raw } : parsed;
  }
  const line = `${merged.slice(0, suburbIdx).join(" ")}, ${merged.slice(suburbIdx).join(" ")}`;
  const parsed = parseAddressLine(line, id);
  return parsed && raw ? { ...parsed, raw } : parsed;
}

/** Parse a pasted block: one address per line, cells split on tabs or 2+ spaces, with an
 *  optional leading ref cell — which is only a ref when the address after it still starts
 *  with its own street number. A bare number followed by a street NAME is the number. */
export function parseAddressBlock(text: string): ParsedAddress[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = splitCells(line);
      if (cells.length < 2) return parseAddressLine(line);

      let id: string | undefined;
      const rest = cells.slice(1).join(" ");
      const restIsAddress = /\d/.test(rest) && (/,/.test(rest) || STATE_RE.test(rest));
      if (restIsAddress && STARTS_WITH_NUMBER_RE.test(rest) && !UNIT_KEYWORD_RE.test(cells[0])) {
        id = cells[0];
        cells.shift();
      }
      return parseAddressCells(cells, id, cells.join(" "));
    })
    .filter((a): a is ParsedAddress => !!a);
}
