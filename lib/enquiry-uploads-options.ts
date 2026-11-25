// Limits and file types for attachments on the enquiry form.
//
// Import-free on purpose, like lib/leads-options.ts: the client form reads these, and
// anything pulled in here lands on every marketing page.

export const MAX_UPLOAD_FILES = 5;
/** Per file. Also the bucket's own limit (migration 0031), so Storage enforces it too. */
export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
/** All files together. Base64 adds a third, and a mailbox starts refusing mail around
 *  35 MB — 20 MB of files is ~27 MB on the wire, which lands. */
export const MAX_UPLOAD_TOTAL_BYTES = 20 * 1024 * 1024;

/** Extension -> the content type we store and email it as. */
export const UPLOAD_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

export const UPLOAD_MIME_TYPES = [...new Set(Object.values(UPLOAD_TYPES))];

/** The file picker's filter. HEIC is accepted but deliberately NOT listed: an iPhone converts
 *  a photo to JPEG unless the input asks for HEIC by name, and staff on Windows can't open one. */
export const UPLOAD_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

export const UPLOAD_HINT = `PDF, JPG or PNG. Up to ${MAX_UPLOAD_FILES} files, 10 MB each.`;

/** The content type for a file name, or null when it isn't one we take. Goes by the
 *  extension because browsers report an empty `type` for files they don't know (HEIC on
 *  Windows) — the server checks the actual bytes before anything is emailed. */
export function uploadTypeFor(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return UPLOAD_TYPES[ext] ?? null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
