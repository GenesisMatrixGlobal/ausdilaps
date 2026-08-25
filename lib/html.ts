/**
 * HTML-safety helpers for content we did not write.
 *
 * The tender pipeline renders third-party text — email bodies, RSS titles, and model
 * output derived from both — into an HTML email sent from our own DKIM-signed domain to
 * staff who trust it. That is the whole risk: an unescaped `</td><a href=...>` in a
 * tender title becomes a convincing internal phishing link.
 *
 * The `esc()` in app/api/quote/route.ts handles `& < >` only. That is fine there (it
 * interpolates our own validated form fields into element bodies) but unsafe here: no
 * quote escaping means it cannot be used in attribute position, and it does nothing about
 * URLs or invisible characters. This module is the hardened successor for new code.
 */

/** Escapes the five characters that matter in both element and attribute position. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Characters that change what a string *looks* like without changing what it says.
 *
 * Built from escape sequences rather than literals so the source stays pure ASCII and
 * greppable — a raw bidi override pasted into a source file is itself invisible.
 * Keeps \t \n \r; strips everything else in the C0/C1 ranges.
 */
const INVISIBLE = new RegExp(
  [
    "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]", // C0 / C1 controls
    "[\\u200B-\\u200F]", // zero-width space, ZWNJ, ZWJ, LTR/RTL marks
    "[\\u202A-\\u202E]", // bidi embeddings and overrides
    "[\\u2060-\\u2064]", // word joiner, invisible operators
    "[\\u2066-\\u2069]", // bidi isolates
    "\\uFEFF", // BOM / zero-width no-break space
  ].join("|"),
  "g"
);

/**
 * Strips the characters above. Visual spoofing of an agency name — a bidi override that
 * makes a hostile domain render back-to-front — is invisible to a reader and invisible to
 * escapeHtml, so it has to be removed rather than encoded.
 */
export function stripInvisible(value: string): string {
  return value.replace(INVISIBLE, "");
}

/** Removes CR/LF/NUL from anything bound for an email header — subject lines especially. */
export function stripHeaderChars(value: string): string {
  return value.replace(/[\r\n\u0000]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The one function every interpolation of untrusted text should go through.
 *
 * Order matters: strip invisibles first (so they cannot survive as entities), then
 * escape, then truncate — truncating last means the cap counts visible characters rather
 * than half an entity.
 */
export function safeText(value: string | null | undefined, max = 500): string {
  if (!value) return "";
  const cleaned = stripInvisible(value).replace(/\s+/g, " ").trim();
  const clipped = cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
  return escapeHtml(clipped);
}

/**
 * Validates a third-party URL before we ever render it as a link.
 *
 * https only, credentials stripped, length capped. Deliberately NOT a host allowlist —
 * portal domains change and an allowlist would break real links. The compensating control
 * is display: callers render `host` as plain text beside the link and never use sender-
 * or model-supplied text as the label, so a human sees `evil-tenders.ru` before they
 * click. Escaping an href stops injection; it does not stop navigation.
 */
export function safeExternalUrl(raw?: string | null): { href: string; host: string } | null {
  if (!raw || raw.length > 2048) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    return { href: escapeHtml(url.toString()), host: escapeHtml(url.hostname) };
  } catch {
    return null;
  }
}

/** Inline styles that hide text from a human but not from a naive tag-stripper. */
const HIDDEN_STYLE = "display\\s*:\\s*none|visibility\\s*:\\s*hidden|font-size\\s*:\\s*0|opacity\\s*:\\s*0";

const HIDDEN_ELEMENT = new RegExp(
  `<(div|span|p|td|tr|table|section|a)\\b[^>]*style\\s*=\\s*["'][^"']*(?:${HIDDEN_STYLE})[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`,
  "gi"
);

/**
 * Decodes the named and numeric entities that actually turn up in RSS and email.
 *
 * Needed as its own step because XML entity-encodes markup and URLs: a feed's
 * `<description>` arrives as `&lt;p&gt;text&lt;/p&gt;`, and a `<link>` as
 * `...?a=1&amp;b=2`. Treating either as literal text gives you tags in the classifier
 * input and a bogus query parameter in the dedupe key.
 */
export function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    // &amp; last, so "&amp;lt;" decodes to "&lt;" rather than "<".
    .replace(/&amp;/gi, "&");
}

/**
 * HTML to plain text, for the copy we hand the classifier and store as `excerpt`.
 *
 * Decodes entities FIRST, then strips. The other order leaves entity-encoded markup —
 * which is exactly how RSS delivers it — sitting in the output as literal `<p>` and
 * `<script>` text for the model to read.
 *
 * Drops <script>/<style>/<head> bodies outright rather than just stripping their tags, so
 * that text is gone rather than merely unrendered, and makes a best-effort pass at
 * elements hidden by an inline style. Also cuts token cost by roughly 70% on a portal
 * alert email.
 *
 * Be clear about the limit: hidden-text detection in HTML is not winnable with regex.
 * A payload hidden via a CSS class, an external stylesheet, off-screen positioning, or
 * text coloured to match its background will survive this and reach the model. That is
 * accepted, because it is not the layer doing the real work — the model has no tools and
 * cannot act, its output is schema-validated, and anything that reads as an instruction
 * sets injection_suspected and suppresses the forward. This function reduces the surface;
 * lib/tenders/classify.ts is what actually contains the risk.
 */
export function htmlToText(html: string, maxChars = 12_000): string {
  const text = decodeEntities(html)
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(HIDDEN_ELEMENT, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[truncated]` : text;
}
