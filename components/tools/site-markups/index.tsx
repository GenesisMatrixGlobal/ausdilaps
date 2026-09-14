"use client";

import { useState } from "react";
import { TabBar } from "@/components/ui/tab-bar";
import { ToolHeaderSlot } from "@/components/staff/tool-header-slot";
import { RoadMarkupTab } from "./road-tab";
import { ResidentialMarkupTab } from "./residential-tab";
import { MeasureTab } from "./measure-tab";
import type { ToolProps } from "@/lib/tools/registry";

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

/** Rhys's sandbox. Admins only. It runs the SAME component and mode as Building Markup, so
 *  today the two tabs are identical — that is the point: whatever is being tried next is
 *  added here first, behind a flag, and promoted into the staff tab by hand once it holds up.
 *  Nothing on this tab is promised to anyone. */
const DEV_TAB = { key: "dev", label: "*DEV*" } as const;

type Tab = (typeof TABS)[number]["key"] | typeof DEV_TAB.key;

export function SiteMarkupsTool({ isAdmin = false }: ToolProps) {
  const tabs: readonly { key: Tab; label: string }[] = isAdmin ? [...TABS, DEV_TAB] : TABS;
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
        <TabBar tabs={tabs} active={tab} onChange={show} className="border-b-0" />
      </ToolHeaderSlot>
      {/* `hidden`, not conditional rendering: see `visited` above. */}
      {visited.has("residential") && (
        <div hidden={tab !== "residential"}>
          {/* PROMOTED FROM *DEV* (2026-09-14): Building Markup is the multi-property markup
              now. One address typed into the search bar still produces the old single-address
              drawing — "Pre-select surrounding assets" writes it as a `+` line, which resolves
              to a RED lot with its adjoining lots in blue — so nothing an estimator did before
              got harder, and a list of addresses is now possible on the staff tab.
              `mode="single"` is no longer reachable from the UI; it is kept in residential-tab
              because the file-open path restores `subjectRing`/`hideSubject` from the saved
              file, so every markup saved before today still opens here with its red subject. */}
          <ResidentialMarkupTab mode="multi" />
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
      {isAdmin && visited.has("dev") && (
        <div hidden={tab !== "dev"}>
          {/* The same component as Building Markup above — but its OWN instance, so anything
              tried here never touches the markup an estimator has open on the first tab, and
              with `dev` set: experiments inside residential-tab are gated on that prop, staff
              never see them, and promoting one is deleting its `dev &&`. */}
          <ResidentialMarkupTab mode="multi" dev />
        </div>
      )}
    </div>
  );
}
