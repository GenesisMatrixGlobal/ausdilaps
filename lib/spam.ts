/**
 * Junk-submission check for the enquiry form. Pure, so `npm run check:spam` can pin it.
 *
 * Written against a real bot (Oct 2026, ~30 posts over Tor in three days): every field is a
 * random mixed-case string — name "fQSwaixgizuRlqYTYlEwnWFy", message "aAyfymbolQOcoWoZfO" —
 * beside a REAL third party's email address, so our acknowledgement email lands in a stranger's
 * inbox. That is subscription bombing (burying the victim's inbox), and every ack we send for it
 * costs the ausdilaps.com.au sending reputation that real acknowledgements depend on.
 *
 * Turnstile is the main defence; this is the backstop for a bot that pays to solve it.
 * It drops a submission only when the name AND the message are BOTH junk, so a real person
 * with an unusual name — or one who leaves the message blank — can never trip it.
 */

/** One letters-only word, 12+ long, with 3+ capitals after the first letter. */
export function isJunkToken(value: string | undefined): boolean {
  const v = (value ?? "").trim();
  if (!/^[A-Za-z]{12,}$/.test(v)) return false;
  const innerCaps = v.slice(1).replace(/[^A-Z]/g, "").length;
  return innerCaps >= 3;
}

export function looksLikeJunk(input: { name: string; notes?: string }): boolean {
  return isJunkToken(input.name) && isJunkToken(input.notes);
}
