// The sheet's TICKED rows as a CSV — every column the sheet shows, in the sheet's order, so what
// lands in Excel reads like what was on screen. Pure; the download itself is the table's job.

import { csvCell as cell } from "@/lib/csv";
import { assetTypeFor, type LineItemRow } from "@/lib/markup-layers/line-items";

export const CSV_COLUMNS = [
  "#",
  "Street",
  "Suburb",
  "Product",
  "Asset type",
  "Levels",
  "Internal m²",
  "External m²",
  "Internal $/m²",
  "External $/m²",
  "Qty",
] as const;

/** Selected rows only — the unticked ones are not line items. Starts with a BOM so Excel reads
 *  the ² as UTF-8 instead of guessing Latin-1 and printing "mÂ²". CRLF, which Excel expects. */
export function lineItemsCsv(rows: LineItemRow[]): string {
  const lines = [CSV_COLUMNS.map(cell).join(",")];
  for (const row of rows) {
    if (!row.selected) continue;
    const v = row.values;
    lines.push(
      [
        row.number ?? "",
        v.street,
        v.suburb,
        v.product,
        assetTypeFor(v),
        v.levels,
        v.internalMetres,
        v.externalMetres,
        v.internalRate,
        v.externalRate,
        v.quantity,
      ]
        .map(cell)
        .join(",")
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
