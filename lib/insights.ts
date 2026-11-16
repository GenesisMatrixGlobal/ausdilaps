import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export { formatInsightDate } from "./format";

const DIR = path.join(process.cwd(), "content/insights");

export const INSIGHT_CATEGORIES = [
  "Dilapidation knowledge",
  "Standards & advocacy",
  "Major projects",
  "Natural events",
] as const;

export type InsightCategory = (typeof INSIGHT_CATEGORIES)[number];

export type InsightMeta = {
  slug: string;
  title: string;
  /** Shorter <title> when `title` would run past 60 characters with " — AusDilaps". */
  seoTitle?: string;
  excerpt: string;
  date: string; // YYYY-MM-DD
  category: InsightCategory;
  author: string;
  image?: string;
  draft?: boolean;
};

export type Insight = InsightMeta & { content: string };

function readFile(slug: string) {
  const raw = fs.readFileSync(path.join(DIR, `${slug}.mdx`), "utf8");
  return matter(raw);
}

/** All published insights, newest first. */
export function getAllInsights(): InsightMeta[] {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => {
      const slug = f.replace(/\.mdx$/, "");
      const { data } = readFile(slug);
      return { slug, ...(data as Omit<InsightMeta, "slug">) };
    })
    .filter((m) => !m.draft)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getInsightSlugs(): string[] {
  return getAllInsights().map((i) => i.slug);
}

export function getInsight(slug: string): Insight | null {
  const file = path.join(DIR, `${slug}.mdx`);
  if (!fs.existsSync(file)) return null;
  const { data, content } = readFile(slug);
  return { slug, content, ...(data as Omit<InsightMeta, "slug">) };
}
