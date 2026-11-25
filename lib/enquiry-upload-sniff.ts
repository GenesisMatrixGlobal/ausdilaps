// Pure helpers for an uploaded file: what it is called, and what its bytes actually are.
//
// Kept apart from lib/enquiry-uploads.ts (which is `server-only`) and import-free, so a tsx
// script can run them against real files.

/** The uploader's own file name, made safe to show and attach: no path separators or control
 *  characters, and capped from the front so the extension survives. Everything else — brackets,
 *  ampersands, accents — is kept as typed. */
export function cleanUploadName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f/\\]+/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.slice(-100) || "file";
}

/**
 * The object name a file is stored under: its position, then its name in base64url.
 *
 * Storage only allows a narrow set of characters in a key, and swapping the rest for `_`
 * turned "Plan (rev B).pdf" into "Plan _rev B_.pdf" on the email. Encoding the name carries
 * ANY name through untouched, and there is no table to keep it in otherwise.
 */
export function uploadKeyFor(position: number, name: string): string {
  return `${position}-${Buffer.from(cleanUploadName(name), "utf8").toString("base64url")}`;
}

/** The file name back out of `uploadKeyFor`'s object name. */
export function nameFromUploadKey(key: string): string {
  return cleanUploadName(Buffer.from(key.replace(/^\d+-/, ""), "base64url").toString("utf8"));
}

/**
 * The kind of file these bytes are, whatever it was called. Null = not something we take.
 *
 * A file's name is fixed when its upload URL is issued, and only allowed extensions get one,
 * so nothing can arrive NAMED as a program; this is the second check, that the contents are
 * a document too.
 */
export function sniffUpload(b: Buffer): string | null {
  if (b.subarray(0, 1024).includes("%PDF-")) return "pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (b.toString("latin1", 4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(b.toString("latin1", 8, 12))) {
    return "heic";
  }
  // .docx, .xlsx and .kmz are all ZIPs. Entry names sit in the archive uncompressed, so the
  // ones that make it a Word file, a workbook or a KMZ can be looked for directly — a plain
  // .zip renamed .docx has none of them. `vbaProject.bin` is a macro project: refused.
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    if (b.includes("vbaProject.bin")) return null;
    if (b.includes("[Content_Types].xml") && b.includes("word/")) return "docx";
    if (b.includes("[Content_Types].xml") && b.includes("xl/")) return "xlsx";
    if (b.includes(".kml")) return "kmz";
    return null;
  }
  // Legacy .doc / .xls (OLE compound file).
  if (b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return "ole";
  // KML is XML text with a <kml> root.
  if (b.subarray(0, 4096).includes("<kml")) return "kml";
  return null;
}
