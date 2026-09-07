/**
 * Closing-date parsing for the per-sender extractors.
 *
 * Every parser here returns null rather than a guess. A closing date is the one field people
 * act on immediately — the handoff email sorts by it and colours anything inside a fortnight
 * orange — so a date read wrong is worse than a date left blank, which at least shows as
 * "no date" and prompts someone to look. The classifier's own prompt takes the same line:
 * "leave a field null rather than guessing".
 *
 * Day-first throughout, because every source here is Australian. `new Date(string)` is
 * deliberately not used: it reads "09-Sep-2026" and bare numeric formats
 * inconsistently across runtimes, and month-first would silently turn 9 September into
 * 9 September only by luck and 3 October into 10 March.
 */

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** First three letters are enough, and they cover both "Sep" and "September". */
function monthNumber(name: string): string | null {
  return MONTHS[name.slice(0, 3).toLowerCase()] ?? null;
}

function iso(day: string, month: string, year: string): string {
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

/**
 * Day, month name, year in either order of separator:
 *   `07-Oct-2026 04:00 PM`   (TenderSearch)
 *   `14 September 2026`      (Felix)
 *
 * The time of day is dropped on purpose. It is stored as a date and every consumer renders a
 * date, so keeping 4pm would imply a precision the rest of the pipeline does not carry.
 */
export function parseDayMonthYear(raw: string): string | null {
  const m = /(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{4})/.exec(raw);
  if (!m) return null;
  const month = monthNumber(m[2]);
  if (!month) return null;
  const day = Number(m[1]);
  if (day < 1 || day > 31) return null;
  return iso(m[1], month, m[3]);
}
