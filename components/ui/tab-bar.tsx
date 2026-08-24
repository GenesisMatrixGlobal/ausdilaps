"use client";

import { cn } from "@/lib/utils";

/** The underline tab bar every staff tool uses for its sub-modes. Was hand-rolled
 *  identically in three tools before this. */
export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: readonly { key: T; label: string }[];
  active: T;
  onChange: (key: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2 border-b border-ad-border", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            active === tab.key
              ? "border-ad-orange text-ad-ink"
              : "border-transparent text-ad-muted hover:text-ad-ink"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
