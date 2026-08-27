"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Renders the Tools and Training panes side by side and hides the inactive one,
 *  instead of swapping one route's children for another's.
 *
 *  Why: the tabs are <Link>s, so switching to Training used to unmount whatever
 *  the tool was holding — filters, uploaded files, half-finished results, all of
 *  it. As Next.js parallel routes, the unmatched slot keeps its rendered subtree
 *  across a soft navigation, so `display: none` is all that's needed and React
 *  state survives untouched.
 *
 *  Two things this does NOT survive, both acceptable:
 *   - a hard reload, which drops the unmatched slot to its default.tsx (null);
 *   - scroll position inside a pane, which the browser resets on display:none.
 *
 *  If a map-based tool ever comes back grey from a toggle, that's display:none
 *  collapsing its container: swap the `hidden` class for
 *  `fixed inset-0 invisible pointer-events-none -z-10`, which keeps real
 *  dimensions without affecting layout. */
export function DepartmentPanes({
  department,
  tools,
  training,
}: {
  department: string;
  tools: React.ReactNode;
  training: React.ReactNode;
}) {
  const pathname = usePathname();
  // Matches DepartmentTabs, which highlights Training for /training/manage too.
  const onTraining = pathname.startsWith(`/staff/${department}/training`);

  return (
    <>
      <div className={cn(onTraining && "hidden")} inert={onTraining || undefined}>
        {tools}
      </div>
      <div className={cn(!onTraining && "hidden")} inert={!onTraining || undefined}>
        {training}
      </div>
    </>
  );
}
