"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { cn } from "@/lib/utils";

/** The Tools ⇄ Training toggle. Route-based rather than useState so every tool
 *  and training module is linkable, back-button-safe and pasteable into Teams.
 *
 *  Each tab remembers where its own pane was. Without that, "Tools" always points
 *  at the tool LIST, so coming back from Training navigates the tools slot off the
 *  tool and unmounts it — undoing the state preservation DepartmentPanes exists to
 *  provide. Pointing the tab at the pane's current URL makes the return trip a
 *  no-op navigation for that slot, so nothing is torn down.
 *
 *  This component lives in the department layout, which survives every navigation
 *  within a department, so a ref is enough to hold the memory. */
export function DepartmentTabs({ department }: { department: string }) {
  const pathname = usePathname();
  const base = `/staff/${department}`;

  const last = useRef({ department, tools: `${base}/tools`, training: `${base}/training` });
  // Switching department reuses this component rather than remounting it, so a
  // stale memory would send you to another department's tool.
  if (last.current.department !== department) {
    last.current = { department, tools: `${base}/tools`, training: `${base}/training` };
  }
  if (pathname.startsWith(`${base}/tools`)) last.current.tools = pathname;
  if (pathname.startsWith(`${base}/training`)) last.current.training = pathname;

  const tabs = [
    {
      key: "tools",
      href: last.current.tools,
      label: "Tools",
      active: pathname.startsWith(`${base}/tools`),
    },
    {
      key: "training",
      href: last.current.training,
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
          key={tab.key}
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
