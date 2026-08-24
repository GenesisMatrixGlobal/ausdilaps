"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** The Tools ⇄ Training toggle. Route-based rather than useState so every tool
 *  and training module is linkable, back-button-safe and pasteable into Teams. */
export function DepartmentTabs({ department }: { department: string }) {
  const pathname = usePathname();
  const base = `/staff/${department}`;

  const tabs = [
    { href: `${base}/tools`, label: "Tools", active: pathname.startsWith(`${base}/tools`) },
    {
      href: `${base}/training`,
      label: "Training",
      active: pathname.startsWith(`${base}/training`),
    },
  ];

  return (
    <div
      role="tablist"
      className="inline-flex rounded-full border border-ad-border bg-ad-surface p-1"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          role="tab"
          aria-selected={tab.active}
          className={cn(
            "rounded-full px-5 py-1.5 text-sm font-medium transition-colors",
            tab.active
              ? "bg-white text-ad-ink shadow-sm"
              : "text-ad-muted hover:text-ad-ink"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
