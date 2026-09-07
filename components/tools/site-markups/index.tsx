"use client";

import { useState } from "react";
import { TabBar } from "@/components/ui/tab-bar";
import { ToolHeaderSlot } from "@/components/staff/tool-header-slot";
import { RoadMarkupTab } from "./road-tab";
import { ResidentialMarkupTab } from "./residential-tab";
import { MeasureTab } from "./measure-tab";

// ⚠️ The LABEL and the code name differ, deliberately. "Building Markup" is what staff
// call it; the tab key, the component (ResidentialMarkupTab), the route
// (/api/kml/standard-markup) and the lib folder all still say residential/standard-markup.
// Renaming those would touch a live API route and every import for a caption change, so
// the label is the only thing that moved. Don't "fix" one half of it.
const TABS = [
  { key: "residential", label: "Building Markup" },
  { key: "road", label: "Road Markup" },
  { key: "measure", label: "Measure" },
] as const;

type Tab = (typeof TABS)[number]["key"];

export function SiteMarkupsTool() {
  const [tab, setTab] = useState<Tab>("residential");
  // Mounted-once-visited, then kept mounted. Two reasons, pulling opposite ways:
  //  - Unmounting on switch throws away whatever the tab was holding — a half-drawn set of
  //    measurements, or a generated markup. Same reasoning as DepartmentPanes.
  //  - But mounting all three up front would build the Measure tab's Google map on every
  //    visit to this tool, and a map instantiation is a billed Dynamic Maps load.
  // So: nothing is built until you open it, and nothing is thrown away after you do.
  const [visited, setVisited] = useState<Set<Tab>>(new Set(["residential"]));

  function show(next: Tab) {
    setTab(next);
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  }

  return (
    <div>
      {/* Rides up into the ToolFrame's title row — border-b-0 because that row already
          carries the rule the active tab underlines against. */}
      <ToolHeaderSlot>
        <TabBar tabs={TABS} active={tab} onChange={show} className="border-b-0" />
      </ToolHeaderSlot>
      {/* `hidden`, not conditional rendering: see `visited` above. */}
      {visited.has("residential") && (
        <div hidden={tab !== "residential"}>
          <ResidentialMarkupTab />
        </div>
      )}
      {visited.has("road") && (
        <div hidden={tab !== "road"}>
          <RoadMarkupTab />
        </div>
      )}
      {visited.has("measure") && (
        <div hidden={tab !== "measure"}>
          {/* The map needs to know it's back on screen — a Google map sized against a
              display:none container returns grey until it re-measures. */}
          <MeasureTab active={tab === "measure"} />
        </div>
      )}
    </div>
  );
}
