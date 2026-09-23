// Pure date handling for the nightly crawl. No env, no network — pinned by check:transcript.
//
// Everything is SYDNEY time: the inspectors' day folders are named for the day they worked, and
// the crawl runs at 4am Sydney. Vercel Cron only speaks UTC and NSW moves its clocks (first
// Sunday in October, first Sunday in April), so the offset is never hard-coded — Intl works it
// out for the instant in question.

export type SydneyTime = { date: string; hour: number; minute: number };

const PARTS = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The Sydney wall-clock date (YYYY-MM-DD) and time for an instant. */
export function sydneyNow(now: Date): SydneyTime {
  const p = Object.fromEntries(PARTS.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

/** YYYY-MM-DD, n days from a YYYY-MM-DD date. Calendar arithmetic, so no time zone applies. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The day the crawl works on: yesterday, in Sydney. */
export function sydneyYesterday(now: Date): string {
  return addDays(sydneyNow(now).date, -1);
}

/** True from `hour:minute` Sydney time onwards, on the given Sydney date. */
export function isAtOrAfter(now: Date, date: string, hour: number, minute = 0): boolean {
  const t = sydneyNow(now);
  if (t.date !== date) return t.date > date;
  return t.hour * 60 + t.minute >= hour * 60 + minute;
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "Tue 22 Sep 2026" — for the log and the emails. */
export function displayDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" });
  return `${wd} ${d} ${MONTHS[m - 1].slice(0, 3).replace(/^./, (c) => c.toUpperCase())} ${y}`;
}

// ── Finding the day folder by NAME ────────────────────────────────────────────────────────
// The tree is <year> / <month> / <day>. How each level is spelled is the inspectors' habit, not
// ours, so matching is tolerant: a month may be "09", "9", "Sep", "September", "09 September"
// or "2026-09"; a day may be "22", "22nd", "Tue 22", "2026-09-22" or "22.09.26". A name only
// matches when every number in it agrees — "2026-10-22" is never the 22nd of September.

function tokens(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Numbers in a folder name, with ordinals ("22nd") read as their number. */
function numbers(name: string): number[] {
  const out: number[] = [];
  for (const t of tokens(name)) {
    const m = /^(\d+)(st|nd|rd|th)?$/.exec(t);
    if (m) out.push(Number(m[1]));
  }
  return out;
}

function namesMonth(name: string, month: number): boolean | null {
  const full = MONTHS[month - 1];
  let saw: boolean | null = null;
  for (const t of tokens(name)) {
    if (!/^[a-z]+$/.test(t) || t.length < 3) continue;
    const i = MONTHS.findIndex((mm) => mm.startsWith(t));
    if (i >= 0) {
      if (!full.startsWith(t)) return false;
      saw = true;
    }
  }
  return saw;
}

function splitYear(nums: number[], year: number): { ok: boolean; rest: number[] } {
  const rest: number[] = [];
  let ok = true;
  for (const n of nums) {
    if (n >= 1000) {
      if (n !== year) ok = false;
    } else if (n >= 100) {
      ok = false;
    } else rest.push(n);
  }
  return { ok, rest };
}

export function matchesYear(name: string, year: number): boolean {
  return numbers(name).includes(year);
}

export function matchesMonth(name: string, year: number, month: number): boolean {
  const { ok, rest } = splitYear(numbers(name), year);
  if (!ok) return false;
  const named = namesMonth(name, month);
  if (named === false) return false;
  if (rest.length === 0) return named === true;
  return rest.length === 1 && rest[0] === month;
}

export function matchesDay(name: string, date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const nums = numbers(name);
  // A two-digit year ("22.09.26") — read the last of three short numbers as the year.
  const short = nums.filter((n) => n < 100);
  if (short.length === 3 && nums.length === 3) {
    if (short[2] !== year % 100) return false;
    nums.pop();
  }
  const yearFirst = nums.length > 0 && nums[0] === year;
  const { ok, rest } = splitYear(nums, year);
  if (!ok) return false;
  if (namesMonth(name, month) === false) return false;
  if (rest.length === 1) return rest[0] === day;
  // Two numbers: ISO order when the year leads ("2026-09-22"), Australian otherwise ("22-09",
  // "22-09-2026"). Never either-way: "2026-09-02" must not read as the 9th of February.
  if (rest.length === 2) return yearFirst ? rest[0] === month && rest[1] === day : rest[0] === day && rest[1] === month;
  return false;
}
