// What an uploaded file actually is, judged by its bytes.
//
// Kept apart from lib/enquiry-uploads.ts (which is `server-only`) and import-free, so a tsx
// script can run it against real files.

/**
 * The kind of file these bytes are, whatever it was called. Null = not something we take.
 *
 * The object key is server-minted with an allowed extension, so nothing can arrive NAMED
 * as a program; this is the second check, that the contents are a document too.
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
