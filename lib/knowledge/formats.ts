/**
 * Upload constants shared by the server extractor and the browser form.
 *
 * Separate from extract.ts purely because that file is `server-only` — it pulls in unpdf
 * and the Supabase service-role client, neither of which belongs in a client bundle. The
 * upload form still needs to know what it may accept, and a hardcoded second copy of the
 * list in the form is how the two quietly drift apart.
 */

export type SourceFormat = "markdown" | "transcript" | "plain";

/** Drives both the `accept` attribute and server-side validation. */
export const ACCEPTED_EXTENSIONS = [".md", ".mdx", ".txt", ".vtt", ".srt", ".pdf"] as const;

/**
 * Must stay at or below `serverActions.bodySizeLimit` in next.config.ts — a file that
 * clears this check but exceeds that one fails in the framework, before any of our code
 * runs, with an error nobody can act on.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "25MB";
