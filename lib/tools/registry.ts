// Staff tool registry — the wrapper that makes tools department-agnostic.
//
// The contract: a tool component knows NOTHING about departments, routes or auth.
// It renders its own UI and nothing else — no <main>, no <h1>. The route
// (app/staff/[department]/tools/[tool]) plus this manifest is the wrapper; the
// component is the payload.
//
// To surface an existing tool to another department, add that department's slug
// to its `departments` array. That's the whole change — no new route, no second
// copy of the component.
//
// Component references go through next/dynamic so these heavy client bundles
// (site-markups alone is ~1,200 lines) only load on the route that renders them.

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { DepartmentSlug } from "@/lib/departments";
import { canAccess, type StaffUser } from "@/lib/auth/session";

export type ToolDefinition = {
  slug: string;
  title: string;
  /** One line — shown on the tool card and as the page subtitle. */
  description: string;
  /** Every department this tool appears under. */
  departments: DepartmentSlug[];
  Component: ComponentType;
};

export const TOOLS: ToolDefinition[] = [
  {
    slug: "site-markups",
    title: "Site Markups",
    description:
      "Snapshot a road segment, or an address with its surrounding lots and frontage highlighted, for estimating and project scoping.",
    departments: ["estimators", "projects"],
    Component: dynamic(() =>
      import("@/components/tools/site-markups").then((m) => m.SiteMarkupsTool)
    ),
  },
  {
    slug: "property-sizing",
    title: "Property Sizing",
    description:
      "Paste addresses or upload a screenshot to get land and lot sizes from government cadastre data, ready for a quoting sheet.",
    departments: ["estimators"],
    Component: dynamic(() =>
      import("@/components/tools/property-sizing").then((m) => m.PropertySizingTool)
    ),
  },
  {
    slug: "tender-watch",
    title: "Tender Watch",
    description:
      "Nightly tender scan — pipeline health, source status and the classified queue.",
    // Must stay in step with TENDER_WATCH_DEPARTMENTS in lib/tenders/config.ts, which the API
    // routes read. Diverge and a department sees the tool card but its data calls 401.
    departments: ["accounts"],
    Component: dynamic(() =>
      import("@/components/tools/tender-watch").then((m) => m.TenderWatchTool)
    ),
  },
  {
    slug: "road-survey-estimator",
    title: "Road Survey Estimator",
    description:
      "Turn a client's road-network .kmz into a priced, per-segment quoting sheet — lengths from the geometry, lanes from OpenStreetMap.",
    departments: ["estimators"],
    Component: dynamic(() =>
      import("@/components/tools/road-survey-estimator").then((m) => m.RoadSurveyEstimatorTool)
    ),
  },
  {
    slug: "floor-plan",
    title: "Floor Plan",
    description:
      "Turn a photo of the inspector's hand sketch into a clean A4 floor plan .png for the report.",
    departments: ["reports"],
    Component: dynamic(() =>
      import("@/components/tools/floor-plan").then((m) => m.FloorPlanTool)
    ),
  },
  {
    slug: "kml-builder",
    title: "KML Builder",
    description:
      "Build survey path .kml files from lat/lng coordinates or by tracing the real road between two cross-streets.",
    departments: ["inspectors"],
    Component: dynamic(() =>
      import("@/components/tools/kml-builder").then((m) => m.KmlBuilderTool)
    ),
  },
];

export function getTool(slug: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.slug === slug);
}

export function toolsForDepartment(slug: DepartmentSlug): ToolDefinition[] {
  return TOOLS.filter((t) => t.departments.includes(slug));
}

/** True if any department this person can open lists this tool. */
export function canUseTool(user: StaffUser, tool: ToolDefinition): boolean {
  return tool.departments.some((d) => canAccess(user, d));
}
