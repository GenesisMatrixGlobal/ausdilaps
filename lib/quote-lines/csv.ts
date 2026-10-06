// The sheet's TICKED rows as a CSV — every column the sheet shows, in the sheet's order, so what
// lands in Excel reads like what was on screen. Pure; the download itself is the table's job.

import { csvDocument } from "@/lib/csv";
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

/** Selected rows only — the unticked ones are not line items. The BOM (so Excel reads the ² as
 *  UTF-8) and the CRLF line endings are csvDocument's. */
export function lineItemsCsv(rows: LineItemRow[]): string {
  return csvDocument(
    CSV_COLUMNS,
    rows
      .filter((row) => row.selected)
      .map((row) => {
        const v = row.values;
        return [
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
        ];
      })
  );
}
