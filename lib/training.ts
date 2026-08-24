// Department training modules — MDX in the repo, one folder per department.
//
//   content/training/<department>/<slug>.mdx
//
// Deliberately a near-copy of lib/insights.ts rather than a shared content layer:
// two 60-line readers beat one generic abstraction with a config object.
//
// Server-only (node:fs) — never import from a client component.

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { DepartmentSlug } from "@/lib/departments";

const ROOT = path.join(process.cwd(), "content/training");

export type TrainingAttachment = { label: string; href: string };

export type TrainingModuleMeta = {
  slug: string;
  department: DepartmentSlug;
  title: string;
  summary: string;
  /** Sort order within the department; lower first. */
  order: number;
  updated?: string; // YYYY-MM-DD
  duration?: string; // e.g. "10 min"
  /** Embed URL for a Loom/YouTube walkthrough. */
  video?: string;
  attachments?: TrainingAttachment[];
  draft?: boolean;
};

export type TrainingModule = TrainingModuleMeta & { content: string };

function dirFor(department: DepartmentSlug) {
  return path.join(ROOT, department);
}

function read(department: DepartmentSlug, slug: string) {
  return matter(fs.readFileSync(path.join(dirFor(department), `${slug}.mdx`), "utf8"));
}

/** Published modules for a department, in frontmatter `order`. */
export function getTrainingModules(department: DepartmentSlug): TrainingModuleMeta[] {
  const dir = dirFor(department);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => {
      const slug = f.replace(/\.mdx$/, "");
      const { data } = read(department, slug);
      return { slug, department, ...(data as Omit<TrainingModuleMeta, "slug" | "department">) };
    })
    .filter((m) => !m.draft)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.title.localeCompare(b.title));
}

export function getTrainingModule(
  department: DepartmentSlug,
  slug: string
): TrainingModule | null {
  const file = path.join(dirFor(department), `${slug}.mdx`);
  if (!fs.existsSync(file)) return null;
  const { data, content } = read(department, slug);
  const meta = data as Omit<TrainingModuleMeta, "slug" | "department">;
  if (meta.draft) return null;
  return { slug, department, content, ...meta };
}

