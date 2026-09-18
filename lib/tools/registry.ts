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
// ARCHIVED tools are retired, not deleted. `archived: true` takes a tool off every
// department's Tools list and out of the "N tools" counts, while leaving it in this registry,
// still openable by its URL, and listed under its own heading on /admin/tools. A retired tool
// that is deleted outright takes its code, its route and any chance of reviewing it with it —
// and tool_usage keeps its rows either way, so the history would point at nothing. Keep the
// `departments` on an archived tool: /admin/tools builds its link from departments[0].
//
// GAMES are the one exception. `kind: "game"` means a thing is available to EVERY
// department and renders under its own "Games & Activities" heading beneath the tools,
// so it carries no `departments` field at all — the type below makes writing one
// impossible. Nothing about this touches the database: the tool-to-department mapping
// lives entirely in this file, and tool_usage stores a bare slug with no department
// column (see the header of 0008_tool_usage.sql).
//
// Component references go through next/dynamic so these heavy client bundles
// (site-markups alone is ~1,200 lines) only load on the route that renders them.

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { DEPARTMENT_SLUGS, type DepartmentSlug } from "@/lib/departments";

/** `title` is a display label and can be changed freely — it is renamed from time to time as
 *  the team's language for a tool settles. `slug` and `code` cannot: the slug is a live route
 *  and a redirect target in data/redirects.ts, and the code is how a tool gets referred to in
 *  past conversations. Rename the title on its own; don't chase it through the rest.
 *
 *  Current label/internal-name divergences, all deliberate:
 *    site-markups          -> "Markup and Measure" (its Building Markup tab is still
 *                             `residential` / standard-markup in code, routes and components)
 *    property-sizing       -> "Bulk Property Sizing"
 *    road-survey-estimator -> "KMZ Analyser"
 *    floor-plan            -> "Floor Plan Generator" */
export type ToolKind = "tool" | "game";

type Common = {
  slug: string;
  /** Short reference code (SMK, PSZ, ...) so a tool can be named in a message
   *  without spelling it out. Deliberately NOT department-prefixed: tools move
   *  between departments, and a code that changes retroactively breaks every
   *  discussion that used it. Once assigned, a code is permanent. */
  code: string;
  title: string;
  /** One line — shown on the tool card and as the page subtitle. */
  description: string;
  Component: ComponentType<ToolProps>;
};

/** What the tool page hands every tool. Optional throughout, so a tool that wants none of it
 *  declares no props at all. */
export type ToolProps = {
  /** Company admin — gates experimental surfaces such as Markup and Measure's *DEV* tab. */
  isAdmin?: boolean;
};

/** A department tool: appears only under the departments listed. */
type DepartmentTool = Common & {
  kind?: "tool";
  /** Every department this tool appears under. Kept on an archived tool too — /admin/tools
   *  builds its "open it anyway" link from departments[0]. */
  departments: DepartmentSlug[];
  /** Retired. Off every department's Tools list and out of the tool counts, but still in the
   *  registry, still reachable by URL, and still shown (separately) on /admin/tools. */
  archived?: true;
};

/**
 * A game: appears under EVERY department, and carries no `departments` field at all.
 *
 * Deliberately a separate member of the union rather than a `departments: []` sentinel. Two
 * concrete reasons, not stylistic ones: `departments[0]` is used to build a link on
 * /admin/tools and would produce "/staff/undefined/...", and `departments.includes(slug)` is
 * false for an empty array, so a game would show under NO department — the exact opposite of
 * what it means. Use departmentsFor() rather than reading the field.
 */
type GameTool = Common & { kind: "game" };

export type ToolDefinition = DepartmentTool | GameTool;

export const TOOLS: ToolDefinition[] = [
  {
    slug: "site-markups",
    code: "SMK",
    title: "Markup and Measure",
    description:
      "Snapshot a road segment, or one address with its surrounding lots highlighted and a whole list of them, or measure lengths and areas straight off a live aerial map.",
    // Unassigned from projects 2026-09-16 (Rhys) — Closeout Markup is what that department uses.
    departments: ["estimators"],
    Component: dynamic(() =>
      import("@/components/tools/site-markups").then((m) => m.SiteMarkupsTool)
    ),
  },
  {
    slug: "property-sizing",
    code: "PSZ",
    title: "Bulk Property Sizing",
    description:
      "Paste addresses or upload a screenshot to get land and lot sizes from government cadastre data, ready for a quoting sheet.",
    // RETIRED 2026-09-16 (Rhys): Markup and Measure's multi-address mode does this and draws
    // it. Archived rather than deleted so it can still be opened and reviewed — its cadastre
    // pipeline (lib/property-sizing/*) is what every markup lookup runs on and is NOT retired.
    departments: ["estimators"],
    archived: true,
    Component: dynamic(() =>
      import("@/components/tools/property-sizing").then((m) => m.PropertySizingTool)
    ),
  },
  {
    slug: "tender-watch",
    code: "TDW",
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
    code: "RSE",
    title: "KMZ Analyser",
    description:
      "Turn a client's road-network .kmz into a per-segment quoting sheet, and turn their edited sheet back into a map for Google Earth.",
    departments: ["estimators", "inspectors"],
    Component: dynamic(() =>
      import("@/components/tools/road-survey-estimator").then((m) => m.RoadSurveyEstimatorTool)
    ),
  },
  {
    slug: "floor-plan",
    code: "FPL",
    title: "Floor Plan Generator",
    description:
      "Turn a photo of the inspector's hand sketch into a clean A4 floor plan .png for the report.",
    departments: ["reports"],
    Component: dynamic(() =>
      import("@/components/tools/floor-plan").then((m) => m.FloorPlanTool)
    ),
  },
  {
    slug: "cover-photo",
    code: "CVR",
    title: "Cover Photo Generator",
    description:
      "Aerial of the property with its boundary in green, sized for the front of a report and filed straight onto the Survey.",
    departments: ["reports"],
    Component: dynamic(() =>
      import("@/components/tools/cover-photo").then((m) => m.CoverPhotoTool)
    ),
  },
  {
    slug: "closeout-markup",
    code: "CLO",
    title: "Closeout Markup",
    description:
      "Paste an opportunity: every property its work orders name, coloured by whether it was inspected, and filed onto the Closeout Markup field.",
    departments: ["projects", "reports"],
    Component: dynamic(() =>
      import("@/components/tools/closeout-markup").then((m) => m.CloseoutMarkupTool)
    ),
  },
  {
    slug: "kml-builder",
    code: "KML",
    title: "KML Builder",
    description:
      "Build survey path .kml files from lat/lng coordinates or by tracing the real road between two cross-streets.",
    departments: ["inspectors"],
    Component: dynamic(() =>
      import("@/components/tools/kml-builder").then((m) => m.KmlBuilderTool)
    ),
  },
  {
    slug: "site-snap",
    code: "SNP",
    kind: "game",
    title: "Site Snap",
    description:
      "A two-minute pixel photo survey \u2014 walk the house, shoot every wall from the room centre, beat the clock without wrecking the quality.",
    Component: dynamic(() =>
      import("@/components/tools/site-snap").then((m) => m.SiteSnapTool)
    ),
  },
];

export function getTool(slug: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.slug === slug);
}

export function getToolByCode(code: string): ToolDefinition | undefined {
  const upper = code.toUpperCase();
  return TOOLS.find((t) => t.code === upper);
}

export function isGame(tool: ToolDefinition): tool is GameTool {
  return tool.kind === "game";
}

/** Retired. Still in the registry and still openable — just not offered anywhere. */
export function isArchived(tool: ToolDefinition): boolean {
  return !isGame(tool) && tool.archived === true;
}

/** Every retired tool, for the archive section on /admin/tools. */
export function archivedTools(): ToolDefinition[] {
  return TOOLS.filter(isArchived);
}

/** Every department a thing shows under. Games are everywhere, by definition. */
export function departmentsFor(tool: ToolDefinition): DepartmentSlug[] {
  return isGame(tool) ? [...DEPARTMENT_SLUGS] : tool.departments;
}

/**
 * Department tools ONLY — games are excluded and listed by games() instead.
 *
 * Keeping games out of here is what stops the "N tools" count on the /staff department
 * picker quietly inflating by the number of games in the registry.
 */
export function toolsForDepartment(slug: DepartmentSlug): ToolDefinition[] {
  return TOOLS.filter((t) => !isGame(t) && !isArchived(t) && t.departments.includes(slug));
}

/** Every game. The same list for every department, which is the whole point. */
export function games(): ToolDefinition[] {
  return TOOLS.filter(isGame);
}

/** Slugs of everything that is a game — for excluding them from tool metrics. */
export const GAME_SLUGS: ReadonlySet<string> = new Set(TOOLS.filter(isGame).map((t) => t.slug));

/**
 * May this thing be opened under this department's URL?
 *
 * An assignment check, not an auth check — app/staff/[department]/layout.tsx has already
 * proved via requireDepartment() that the caller may be in this department at all.
 *
 * ARCHIVED tools deliberately still pass. Being retired means "not offered", not "walled off":
 * an old bookmark keeps working and /admin/tools can link straight to it for a review.
 */
export function canOpenInDepartment(tool: ToolDefinition, slug: DepartmentSlug): boolean {
  return isGame(tool) || tool.departments.includes(slug);
}
