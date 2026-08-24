"use client";

import { useState } from "react";
import { TabBar } from "@/components/ui/tab-bar";
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
      <TabBar tabs={TABS} active={tab} onChange={setTab} />
      {tab === "residential" && <ResidentialMarkupTab />}
      {tab === "road" && <RoadMarkupTab />}
    </div>
  );
}
