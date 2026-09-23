import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";
import { SERVICE_SLUGS } from "@/data/services";
import { LOCATION_SLUGS } from "@/data/locations";
import { PORTFOLIO_SLUGS } from "@/data/portfolio";
import { getInsightSlugs } from "@/lib/insights";

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: { path: string; priority: number }[] = [
    { path: "/", priority: 1.0 },
    { path: "/dilapidation-reports", priority: 0.9 },
    { path: "/our-services", priority: 0.9 },
    { path: "/portfolio", priority: 0.8 },
    { path: "/insights", priority: 0.8 },
    { path: "/dilapidation-reports/samples", priority: 0.7 },
    { path: "/quote", priority: 0.7 },
    { path: "/faq", priority: 0.6 },
    { path: "/terms-and-conditions", priority: 0.3 },
    { path: "/privacy-policy", priority: 0.3 },
    ...SERVICE_SLUGS.map((s) => ({ path: `/our-services/${s}`, priority: 0.8 })),
    ...LOCATION_SLUGS.map((s) => ({ path: `/dilapidation-reports/${s}`, priority: 0.8 })),
    ...PORTFOLIO_SLUGS.map((s) => ({ path: `/portfolio/${s}`, priority: 0.6 })),
    ...getInsightSlugs().map((s) => ({ path: `/insights/${s}`, priority: 0.6 })),
  ];

  return entries.map((e) => ({
    url: absoluteUrl(e.path),
    changeFrequency: "monthly",
    priority: e.priority,
  }));
}
