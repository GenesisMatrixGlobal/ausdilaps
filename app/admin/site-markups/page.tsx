"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { SiteMarkupTab } from "./site-markup-tab";
import { StandardMarkupTab } from "./standard-markup-tab";

export default function SiteMarkupsPage() {
  const [mode, setMode] = useState<"standard-markup" | "site-markup">("standard-markup");

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <p className="text-xs uppercase tracking-[0.15em] text-ad-steel">AusDilaps · Field Tools</p>
      <h1 className="mt-1 text-3xl font-semibold text-ad-ink">Site Markups</h1>

      <div className="mt-6 flex gap-2 border-b border-ad-border">
        {(
          [
            { key: "standard-markup", label: "Residential Mark Up" },
            { key: "site-markup", label: "Road Markup" },
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

      {mode === "standard-markup" && <StandardMarkupTab />}

      {mode === "site-markup" && <SiteMarkupTab />}
    </main>
  );
}
