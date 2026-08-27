// Browser download and clipboard-for-Excel helpers, shared by the staff tools.
//
// Both of these were copy-pasted per tool — downloadBlob in three components, tsv in two —
// which is how they came to live here. There is nothing tool-specific in either.

/** Triggers a browser download of in-memory content — text, or bytes for a binary file. */
export function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Tab-separated text for pasting straight into an open spreadsheet.
 *
 * Deliberately not quoted or escaped: Excel splits a pasted block on tabs and newlines, so
 * a quoted field would arrive with its quotes visible. Cell values must therefore not
 * contain tabs or newlines — true for every field these tools produce. Use a real CSV
 * (papaparse) for anything going to a file.
 */
export function tsv(rows: string[][]): string {
  return rows.map((r) => r.join("\t")).join("\n");
}
