// Reading a Salesforce record reference out of whatever an operator pasted.
//
// Extracted from markup-sync.ts's parseQuoteLookup when a third tool (the Closeout Markup)
// needed the same thing for an Opportunity. The regexes and the pathname-only rule below are
// that function's, unchanged — they have been in production against real pasted URLs since the
// markup sync shipped. parseQuoteLookup now delegates here and keeps its Quote-specific
// kinds, so nothing about the Quote path changed.

/** 15-character case-sensitive Id, or the 18-character case-safe form. */
export const SF_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

/** Key prefixes for the objects a pasted link is allowed to name. Fixed per object in
 *  Salesforce, so a bare Id identifies its own type. */
export const KEY_PREFIXES = {
  Opportunity: "006",
  Quote: "0Q0",
  QuoteLineItem: "0QL",
  WorkOrder: "0WO",
} as const;

export interface SalesforceRef {
  /** The object name when the URL stated one, else inferred from the key prefix, else null.
   *  Null means "an Id we can't type" — the caller decides whether that is usable. */
  object: string | null;
  id: string;
}

/** The object a key prefix belongs to, or null for one we don't know. */
export function objectForId(id: string): string | null {
  const prefix = id.slice(0, 3);
  const hit = Object.entries(KEY_PREFIXES).find(([, p]) => p === prefix);
  return hit ? hit[0] : null;
}

/**
 * A record reference out of a Lightning URL, a classic URL, or a bare Id.
 *
 * Returns null when the input carries no Id at all — a Quote NUMBER, a name, free text. That
 * is an ordinary answer, not an error: callers that accept a number (the quote sync) treat it
 * as one, and callers that don't (the Closeout Markup, which has only an Id to go on) say so
 * in their own words.
 *
 * ⚠️ URLs are searched by PATHNAME ONLY. A host like `ausdilaps--dev.lightning.force.com`
 * contains alphanumeric runs that match the Id shape, and matching one would send the caller
 * looking for a record that does not exist — or, worse, one that does.
 */
export function parseSalesforceRecord(input: string): SalesforceRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    let path: string;
    try {
      path = new URL(trimmed).pathname;
    } catch {
      return null;
    }

    // Lightning: /lightning/r/Opportunity/006.../view — the object name is authoritative.
    const lightning = path.match(/\/r\/([^/]+)\/([a-zA-Z0-9]{15,18})/);
    if (lightning) return { object: lightning[1], id: lightning[2] };

    // Classic and anything else: the LAST path segment shaped like a record Id. Last, because
    // a classic URL can carry a parent Id earlier in the path.
    const candidates = path.split("/").filter((seg) => SF_ID.test(seg));
    if (candidates.length > 0) {
      const id = candidates[candidates.length - 1];
      return { object: objectForId(id), id };
    }
    return null;
  }

  if (SF_ID.test(trimmed)) return { object: objectForId(trimmed), id: trimmed };
  return null;
}

/** SOQL string literals escape backslash and single quote — without this a value containing
 *  an apostrophe would break the query (or worse). */
export function soqlEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
