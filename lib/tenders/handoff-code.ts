import { randomInt } from "node:crypto";

/**
 * The code a staff member types into the "New Opportunity + TenderWatch" flow.
 *
 * ── Why this alphabet ────────────────────────────────────────────────────────────────────
 *
 * The code is read off a phone screen and typed into Salesforce, and is sometimes read ALOUD
 * to whoever is at a desk. So the confusable pairs are gone — no O/0, I/1/L, S/5, Z/2, B/8 —
 * and it is upper case only, because mixed case doubles the chance of a typo for no gain.
 *
 * 27 symbols over 5 places is ~14.3 million codes. At a few hundred tenders a year the odds
 * of a natural collision are negligible, and `allocateHandoffCode` retries on the unique
 * index anyway rather than trusting that arithmetic.
 */
const ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";

const PREFIX = "TW-";
const LENGTH = 5;

/** A fresh candidate. Uses crypto rather than Math.random: these end up in two systems and a
 *  predictable sequence would let one person's code collide with another's on a retry. */
export function generateHandoffCode(): string {
  let out = "";
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `${PREFIX}${out}`;
}

/**
 * Is this a code at all, and what is its canonical form?
 *
 * ⚠️ Forgiving on INPUT, strict on output. Somebody will type `tw 4f7k2`, paste `TW-4F7K2 `
 * with a trailing space, or drop the dash — and a lookup that refuses those sends them back
 * to the email to squint at it, which is the friction this whole feature exists to remove.
 * Returns null only when there is genuinely nothing code-shaped there.
 */
export function normaliseHandoffCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = cleaned.startsWith("TW") ? cleaned.slice(2) : cleaned;
  if (body.length !== LENGTH) return null;
  // Every character must be from the alphabet. Deliberately NOT auto-correcting O->0 or
  // I->1: a silent correction that lands on a DIFFERENT valid code would pre-fill the wrong
  // tender, and the staff member has no way to tell. Better to reject and let them look.
  if (![...body].every((c) => ALPHABET.includes(c))) return null;
  return `${PREFIX}${body}`;
}

/** Exposed so the check script pins the alphabet rather than restating it. */
export const HANDOFF_ALPHABET = ALPHABET;
