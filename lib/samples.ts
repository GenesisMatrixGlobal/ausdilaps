// Pure helpers behind /dilapidation-reports/samples: turn Box's raw folder listing into the
// items the library renders. No I/O, so the parsing rules can be exercised without Box.

import type { BoxCategory, BoxSample } from "@/lib/box";

export type SampleKind = "pdf" | "video" | "image";

export type SampleItem = {
  title: string;
  /** Four-digit year lifted out of the filename, when there is one. */
  year: string | null;
  kind: SampleKind;
  /** e.g. "31 MB". Empty when Box reported no size. */
  size: string;
  url: string;
  category: string;
};

export type SampleCategory = {
  name: string;
  items: SampleItem[];
};

/**
 * Display order for the category chips and sections. Box lists subfolders alphabetically,
 * which puts "Case Studies" and "General" ahead of the reports people actually come for.
 * Folders not listed here are appended alphabetically; "Other" (loose root files) is last.
 */
export const CATEGORY_ORDER = [
  "Residential",
  "Commercial",
  "GPS & Council Assets",
  "Roadways",
  "Specialised Surveys",
  "Case Studies",
  "General",
];

const UNCATEGORISED = "Other";

/**
 * Filename → human title. The filename stays the source of truth (the team controls it
 * from Box), so this only strips boilerplate the team repeats in every name:
 *   "AusDilaps Sample 2026 - Hospital External.pdf" → "Hospital External"
 *   "Case Study - Ipswich Hospital QLD.pdf"         → "Ipswich Hospital QLD"
 *   "Council Assets ... SINGLETON_Redacted.pdf"     → "Council Assets ... Singleton (redacted)"
 */
export function titleFromFilename(name: string): string {
  let t = name.replace(/\.[^.]+$/, "");
  t = t.replace(/[_]+/g, " ");
  t = t.replace(/\bredacted\b/i, "(redacted)");
  t = t.replace(/^\s*(ausdilaps\s+sample|ausdilaps|case\s+study)\b/i, "");
  t = t.replace(/\b(19|20)\d{2}\b/g, " ");
  t = t.replace(/^[\s\-–—·:]+|[\s\-–—·:]+$/g, "");
  t = t.replace(/\s+([,.)])/g, "$1");
  t = t.replace(/\s{2,}/g, " ").trim();
  // Shouty all-caps words read as filenames, not titles. Leave acronyms (≤4 letters) alone.
  t = t.replace(/\b[A-Z]{5,}\b/g, (w) => w[0] + w.slice(1).toLowerCase());
  return t || name;
}

export function yearFromFilename(name: string): string | null {
  const m = name.match(/\b(20\d{2})\b/g);
  return m ? m[m.length - 1] : null;
}

export function kindFor(extension: string): SampleKind {
  if (extension === "pdf") return "pdf";
  if (extension === "mp4" || extension === "mov") return "video";
  return "image";
}

export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / 1_000_000;
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function toSampleItem(s: BoxSample, category: string): SampleItem {
  return {
    title: titleFromFilename(s.name),
    year: yearFromFilename(s.name),
    kind: kindFor(s.extension),
    size: formatSize(s.sizeBytes),
    url: s.url,
    category,
  };
}

export function orderCategories(categories: BoxCategory[]): SampleCategory[] {
  const rank = (name: string): number => {
    if (name === UNCATEGORISED) return Number.MAX_SAFE_INTEGER;
    const i = CATEGORY_ORDER.findIndex((c) => c.toLowerCase() === name.trim().toLowerCase());
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  return [...categories]
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
    .map((c) => ({ name: c.name, items: c.samples.map((s) => toSampleItem(s, c.name)) }));
}
