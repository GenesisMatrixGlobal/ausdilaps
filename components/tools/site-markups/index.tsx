"use client";

import { useState } from "react";
import { TabBar } from "@/components/ui/tab-bar";
import { ToolHeaderSlot } from "@/components/staff/tool-header-slot";
import { RoadMarkupTab } from "./road-tab";
import { ResidentialMarkupTab } from "./residential-tab";

const TABS = [
  { key: "residential", label: "Residential Mark Up" },
  { key: "road", label: "Road Markup" },
] as const;

type Tab = (typeof TABS)[number]["key"];

export function SiteMarkupsTool() {
  const [tab, setTab] = useState<Tab>("residential");

  return (
    <div>
      {/* Rides up into the ToolFrame's title row — border-b-0 because that row already
          carries the rule the active tab underlines against. */}
      <ToolHeaderSlot>
        <TabBar tabs={TABS} active={tab} onChange={setTab} className="border-b-0" />
      </ToolHeaderSlot>
      {tab === "residential" && <ResidentialMarkupTab />}
      {tab === "road" && <RoadMarkupTab />}
    </div>
  );
}
