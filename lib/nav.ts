// Services mega-menu model — the single source of truth for the "Services"
// dropdown (desktop), the mobile accordion, the footer column, and the
// /our-services index grouping. Derived from data/services.ts so labels never
// drift. Grouping = the dilapidation pillar highlighted first, then a flat
// list of the remaining specialist services (no category headers).

import { SERVICE_BY_SLUG } from "@/data/services";

export type NavLink = { label: string; href: string };

/** The flagship pillar — highlighted at the top of the menu. */
export const SERVICES_PILLAR = {
  label: "Dilapidation Reports",
  href: "/dilapidation-reports",
  blurb: "Our flagship — defensible pre and post-construction condition reports.",
};

/** Dilapidation variants, shown beneath the pillar. */
export const DILAPIDATION_SLUGS = [
  "commercial-dilapidation-reports",
  "residential-dilapidation-reports",
  "industrial-dilapidation-reports",
];

/** The remaining specialist services, in menu order. */
export const SPECIALIST_SLUGS = [
  "structural-integrity-assessments",
  "defect-origin-assessments-doa",
  "defect-comparison-assessments",
  "structural-engineering",
  "aerial-drone-surveys",
  "noise-and-vibration-monitoring-services",
  "highways-roads",
];

function toLink(slug: string): NavLink {
  const s = SERVICE_BY_SLUG[slug];
  return { label: s.navLabel ?? s.h1, href: `/our-services/${slug}` };
}

export const SERVICES_DILAPIDATION: NavLink[] = DILAPIDATION_SLUGS.map(toLink);
export const SERVICES_SPECIALIST: NavLink[] = SPECIALIST_SLUGS.map(toLink);

/** Utility links in the menu footer / footer column. */
export const SERVICES_UTILITY: NavLink[] = [
  { label: "All services", href: "/our-services" },
  { label: "Sample reports", href: "/dilapidation-reports/samples" },
];
