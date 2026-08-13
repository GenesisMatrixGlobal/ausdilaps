"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { SiteMarkupTab } from "./site-markup-tab";
import { StandardMarkupTab } from "./standard-markup-tab";

export default function SiteMarkupsPage() {
  const [mode, setMode] = useState<"site-markup" | "standard-markup">("site-markup");

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <p className="text-xs uppercase tracking-[0.15em] text-ad-steel">AusDilaps · Field Tools</p>
      <h1 className="mt-1 text-3xl font-semibold text-ad-ink">Site Markups</h1>
      <p className="mt-2 max-w-2xl text-ad-muted">
        Snapshot a road segment or an address with its surrounding lots and frontage highlighted,
        for the inspection scope on site.
      </p>

      <div className="mt-6 flex gap-2 border-b border-ad-border">
        {(
          [
            { key: "site-markup", label: "Site markup (road snapshot)" },
            { key: "standard-markup", label: "Standard mark up (address snapshot)" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setMode(tab.key)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              mode === tab.key
                ? "border-ad-orange text-ad-ink"
                : "border-transparent text-ad-muted hover:text-ad-ink"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === "site-markup" && <SiteMarkupTab />}

      {mode === "standard-markup" && <StandardMarkupTab />}
    </main>
  );
}
