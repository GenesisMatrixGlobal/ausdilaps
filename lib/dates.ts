/** "5 Oct 2026, 2:15 pm" in Brisbane time — the one format admin pages and notification
 *  emails use for a timestamp. Four copies of this formatter existed before 2026-10-05. */
export function formatBrisbane(date: Date | string = new Date()): string {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Brisbane",
  }).format(typeof date === "string" ? new Date(date) : date);
}
