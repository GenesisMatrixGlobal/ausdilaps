"use client";

// Slug → component for every CLIENT tool. Imported by the tool page ONLY
// (app/staff/[department]/@tools/tools/[tool]/page.tsx).
//
// This lives apart from lib/tools/registry.ts on purpose. The registry is read by a dozen
// SERVER components (/admin, /admin/tools, /admin/staff, /staff, the tools list…), and a
// server component that imports a module importing a client component ships that client
// component's bundle as entry JS — rendered or not. With the components in the registry,
// every page that counted tools carried every tool (~890KB). next/dynamic only splits from
// inside a CLIENT component, which is what this file is: each tool below is its own chunk,
// loaded by the one tool page that renders it.
//
// Tender Watch is not here: it is a SERVER component (it loads its own data), so the tool
// page imports and renders it directly. A NEW client tool needs a line here as well as its
// entry in the registry.

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { ToolProps } from "@/lib/tools/registry";

const TOOL_COMPONENTS: Record<string, ComponentType<ToolProps>> = {
  "site-markups": dynamic(() =>
    import("@/components/tools/site-markups").then((m) => m.SiteMarkupsTool)
  ),
  "property-sizing": dynamic(() =>
    import("@/components/tools/property-sizing").then((m) => m.PropertySizingTool)
  ),
  "road-survey-estimator": dynamic(() =>
    import("@/components/tools/road-survey-estimator").then((m) => m.RoadSurveyEstimatorTool)
  ),
  "floor-plan": dynamic(() =>
    import("@/components/tools/floor-plan").then((m) => m.FloorPlanTool)
  ),
  "cover-photo": dynamic(() =>
    import("@/components/tools/cover-photo").then((m) => m.CoverPhotoTool)
  ),
  "closeout-markup": dynamic(() =>
    import("@/components/tools/closeout-markup").then((m) => m.CloseoutMarkupTool)
  ),
  "transcription-buddy": dynamic(() =>
    import("@/components/tools/transcription-buddy").then((m) => m.TranscriptionBuddyTool)
  ),
  "kml-builder": dynamic(() =>
    import("@/components/tools/kml-builder").then((m) => m.KmlBuilderTool)
  ),
  "site-snap": dynamic(() =>
    import("@/components/tools/site-snap").then((m) => m.SiteSnapTool)
  ),
  "crack-blast": dynamic(() =>
    import("@/components/tools/crack-blast").then((m) => m.CrackBlastTool)
  ),
};

/** Renders one client tool by slug. The slug crosses the server/client boundary as a string —
 *  a server component cannot dot into a client module's exports, so it cannot be handed the
 *  map itself. A registry entry with no component here is a developer error, and says so
 *  rather than rendering an empty frame. */
export function ClientTool({ slug, ...props }: { slug: string } & ToolProps) {
  const Component = TOOL_COMPONENTS[slug];
  if (!Component) {
    throw new Error(`No component for tool "${slug}" — add it to components/tools/tool-components.tsx`);
  }
  return <Component {...props} />;
}
