// CSV that Excel opens correctly. Extracted from lib/quote-lines/csv.ts when the Closeout
// Markup needed its own sheet export — the quoting, the BOM and the line ending are the fiddly
// part, and a second copy of them is a second chance to get one wrong.

/** RFC 4180 quoting: anything holding a comma, a quote or a line break is wrapped, quotes doubled. */
export function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** ⚠️ Starts with a BOM so Excel reads `m²` as UTF-8 instead of guessing Latin-1 and printing
 *  "mÂ²", and uses CRLF, which Excel expects. */
export function csvDocument(header: readonly (string | number | null)[], rows: (string | number | null | undefined)[][]): string {
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
