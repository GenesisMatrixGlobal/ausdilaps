// Departments — the single source of truth for the staff portal.
//
// Adding a department = one entry here. No migration needed: profiles.departments
// is a text[] and these slugs are what go in it.
//
// Slug note: the back-office/finance department is `accounts`, not `admin` — /staff/admin
// sitting next to /admin (company admins) would be a permanent source of confusion. It
// carries the label "Admin & Accounts": back-office admin and finance are one team here,
// so they were merged from the original separate `accounts` and `office` departments.

export type DepartmentSlug =
  | "estimators"
  | "inspectors"
  | "projects"
  | "reports"
  | "accounts";

export type Department = {
  slug: DepartmentSlug;
  label: string;
  /** One line shown on the /staff department card. */
  blurb: string;
};

export const DEPARTMENTS: Department[] = [
  {
    slug: "estimators",
    label: "Estimators",
    blurb: "Sizing, site markups and quoting tools, plus estimator training.",
  },
  {
    slug: "inspectors",
    label: "Inspectors",
    blurb: "Field capture, survey paths and on-site reference material.",
  },
  {
    slug: "projects",
    label: "Projects",
    blurb: "Project scoping, markups and delivery references.",
  },
  {
    slug: "reports",
    label: "Reports",
    blurb: "Report production standards, templates and QA.",
  },
  {
    slug: "accounts",
    label: "Admin & Accounts",
    blurb: "Invoicing, billing and finance, plus back-office processes, leads and general company reference.",
  },
];

export const DEPARTMENT_SLUGS = DEPARTMENTS.map((d) => d.slug);

export function getDepartment(slug: string): Department | undefined {
  return DEPARTMENTS.find((d) => d.slug === slug);
}

export function isDepartmentSlug(value: string): value is DepartmentSlug {
  return DEPARTMENT_SLUGS.includes(value as DepartmentSlug);
}

/** Drops anything that isn't a live department slug — profiles.departments is a
 *  free-form text[], so never trust its contents without filtering. */
export function normaliseDepartments(values: unknown): DepartmentSlug[] {
  if (!Array.isArray(values)) return [];
  return DEPARTMENT_SLUGS.filter((slug) => values.includes(slug));
}
