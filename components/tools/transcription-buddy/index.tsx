"use client";

// Transcription Buddy — two tabs over ONE pipeline.
//   Manual     — paste Box links, transcribe now (manual.tsx).
//   Daily runs — the nightly crawl of Inspector Uploads: what it found, transcribed, missed and
//                reported, night by night (daily-runs.tsx).
// Both panes stay mounted once visited, so switching tabs never throws away a queue in progress
// (the Markup and Measure rule). An email link lands on Daily runs with ?tab=daily.

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ToolProps } from "@/lib/tools/registry";
import { ManualTranscription } from "./manual";
import { DailyRuns } from "./daily-runs";

type Tab = "manual" | "daily";

const TABS: { key: Tab; label: string }[] = [
  { key: "manual", label: "Manual" },
  { key: "daily", label: "Daily runs" },
];

export function TranscriptionBuddyTool({ isAdmin }: ToolProps) {
  const params = useSearchParams();
  const initial: Tab = params.get("tab") === "daily" ? "daily" : "manual";
  const [tab, setTab] = useState<Tab>(initial);
  const [visited, setVisited] = useState<Record<Tab, boolean>>({ manual: initial === "manual", daily: initial === "daily" });

  return (
    <div>
      <div className="mb-5 inline-flex overflow-hidden rounded-full border border-ad-border text-sm" role="tablist" aria-label="Transcription Buddy">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => {
              setTab(t.key);
              setVisited((v) => (v[t.key] ? v : { ...v, [t.key]: true }));
            }}
            className={cn("h-11 px-5 font-medium transition-colors", tab === t.key ? "bg-ad-navy text-white" : "text-ad-ink hover:bg-ad-surface")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {visited.manual && (
        <div hidden={tab !== "manual"}>
          <ManualTranscription />
        </div>
      )}
      {visited.daily && (
        <div hidden={tab !== "daily"}>
          <DailyRuns isAdmin={!!isAdmin} />
        </div>
      )}
    </div>
  );
}
